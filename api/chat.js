import { GoogleGenAI } from '@google/genai'
import { Langfuse } from 'langfuse'
import { waitUntil } from '@vercel/functions'
import SYSTEM_PROMPT_FALLBACK from '../chatbot-prompt.txt'
import {
  calcCost, isRagEnabled, PORTFOLIO_TOOL, formatChunksForContext,
  searchPortfolio, filterSourcesByResponse, detectMentionedArticles,
  HOME_SOURCE, classifyIntent, sendJailbreakAlert,
  containsFingerprint, LEAK_RESPONSE,
} from './_shared/rag.js'
import { getSystemPrompt } from './_shared/prompt.js'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

// ---------------------------------------------------------------------------
// Langfuse
// ---------------------------------------------------------------------------

let langfuseClient = null
function getLangfuse() {
  if (!langfuseClient && process.env.LANGFUSE_SECRET_KEY) {
    langfuseClient = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL,
    })
  }
  return langfuseClient
}

// ---------------------------------------------------------------------------
// Convert Anthropic-style messages to Gemini format
// ---------------------------------------------------------------------------

function toGeminiContents(messages) {
  return messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }))
}

// ---------------------------------------------------------------------------
// Gemini tool definition (mirrors PORTFOLIO_TOOL from rag.js)
// ---------------------------------------------------------------------------

const GEMINI_PORTFOLIO_TOOL = {
  functionDeclarations: [{
    name: PORTFOLIO_TOOL.name,
    description: PORTFOLIO_TOOL.description,
    parameters: PORTFOLIO_TOOL.input_schema,
  }],
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const config = {
  runtime: 'edge',
}

export default async function handler(req) {
  const t0 = Date.now()

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const langfuse = getLangfuse()
  let trace = null

  try {
    const { messages, lang, sessionId, currentPage } = await req.json()

    // Input length validation
    const bodySize = JSON.stringify({ messages, lang, sessionId, currentPage }).length
    if (bodySize > 50000) {
      return new Response(JSON.stringify({ error: 'Request too large' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Truncate overly long user messages
    const rawLastMessage = messages.filter(m => m.role === 'user').pop()?.content || ''
    const lastUserMessage = rawLastMessage.slice(0, 2000)
    const intentTags = classifyIntent(lastUserMessage)

    // Tag synthetic traffic (evals, adversarial, regression tests)
    const traceSource = req.headers.get('x-trace-source')
    if (traceSource) intentTags.push(`source:${traceSource}`)

    if (intentTags.includes('jailbreak-attempt') && !traceSource) {
      waitUntil(sendJailbreakAlert(lastUserMessage))
    }

    // Prompt versioning: Langfuse with file fallback
    let systemPromptText
    let promptVersion
    const overrideVersion = req.headers.get('x-prompt-version')
    const overrideAuth = req.headers.get('x-prompt-auth')
    if (overrideAuth === process.env.PROMPT_REGRESSION_SECRET && overrideVersion && langfuse) {
      try {
        const prompt = await langfuse.getPrompt('chatbot-system', parseInt(overrideVersion), {
          type: 'text', cacheTtlSeconds: 0,
        })
        systemPromptText = prompt.prompt
        promptVersion = prompt.version
      } catch {
        systemPromptText = SYSTEM_PROMPT_FALLBACK
        promptVersion = 'file'
      }
    } else {
      const { text, version } = await getSystemPrompt(langfuse)
      systemPromptText = text
      promptVersion = version
    }

    if (langfuse) {
      trace = langfuse.trace({
        name: 'chat',
        sessionId: sessionId || undefined,
        tags: [lang, ...intentTags],
        metadata: {
          lang,
          messageCount: messages.length,
          lastUserMessage: lastUserMessage.slice(0, 200),
          currentPage: currentPage || null,
          promptVersion,
        },
      })
    }

    // Canary word
    const canary = 'ZXCV_' + crypto.randomUUID().slice(0, 8)

    // Dynamic system prompt parts
    const langInstruction = lang === 'en'
      ? `The user is browsing in English. You MUST respond in English. Contact email: pratyush@prabisha.com\ninternal_ref: ${canary}`
      : `El usuario navega en español. Responde en español. Email de contacto: pratyush@prabisha.com\ninternal_ref: ${canary}`

    const pageContext = currentPage
      ? `\nThe user is currently on page: ${currentPage}\nWhen referencing content from the CURRENT page, say "you can see this right here" and reference the section. When referencing OTHER articles, mention them by name.`
      : ''

    const systemInstruction = `${systemPromptText}\n\n${langInstruction}${pageContext}`

    const cleanMessages = messages.map(m => ({ role: m.role, content: m.content }))
    const geminiContents = toGeminiContents(cleanMessages)

    // -----------------------------------------------------------------------
    // Agentic RAG flow
    // -----------------------------------------------------------------------

    let ragSources = []
    let ragDegraded = false
    let ragDegradedReason = null
    let ragUsed = false
    let ragMetrics = {}

    const ragEnabled = isRagEnabled()

    if (ragEnabled) {
      // First call: let Gemini decide if it needs to search (non-streaming)
      const toolDecisionSpan = trace?.span({ name: 'tool_decision' })
      const td0 = Date.now()

      const firstResponse = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: geminiContents,
        config: {
          systemInstruction,
          tools: [GEMINI_PORTFOLIO_TOOL],
          maxOutputTokens: 300,
        },
      })

      const toolDecisionMs = Date.now() - td0
      const tdUsage = firstResponse.usageMetadata
      const tdInputTokens = tdUsage?.promptTokenCount || 0
      const tdOutputTokens = tdUsage?.responseTokenCount || 0
      const functionCalls = firstResponse.functionCalls

      toolDecisionSpan?.end({
        metadata: {
          stopReason: functionCalls?.length ? 'tool_use' : 'end_turn',
          toolUsed: !!(functionCalls?.length),
          inputTokens: tdInputTokens,
          outputTokens: tdOutputTokens,
          latencyMs: toolDecisionMs,
          cost: calcCost('gemini-2.0-flash', tdInputTokens, tdOutputTokens),
        },
      })

      if (functionCalls?.length) {
        ragUsed = true
        const functionCall = functionCalls[0]
        const searchQuery = functionCall.args?.query || lastUserMessage

        // Execute RAG pipeline
        const ragResult = await searchPortfolio(searchQuery, trace, ai)
        ragSources = ragResult.sources
        ragDegraded = ragResult.degraded
        ragDegradedReason = ragResult.degradedReason
        ragMetrics = ragResult.metrics

        const toolResultContent = ragResult.chunks
          ? formatChunksForContext(ragResult.chunks)
          : 'No relevant content found in portfolio articles. You MUST NOT fabricate project details. Say you don\'t have that information and suggest contacting Santiago directly.'

        // Build conversation with tool result for Gemini
        const contentsWithTool = [
          ...geminiContents,
          {
            role: 'model',
            parts: [{ functionCall: { name: functionCall.name, args: functionCall.args, id: functionCall.id } }],
          },
          {
            role: 'user',
            parts: [{ functionResponse: { name: functionCall.name, response: { result: toolResultContent }, id: functionCall.id } }],
          },
        ]

        return streamResponse({
          systemInstruction,
          contents: contentsWithTool,
          ragSources,
          ragDegraded,
          ragDegradedReason,
          canary,
          intentTags,
          trace,
          langfuse,
          lastUserMessage,
          t0,
          ragUsed,
          ragMetrics,
          ragUsage: ragResult.usage,
          toolDecisionMs,
          tdInputTokens,
          tdOutputTokens,
          lang,
          fallbackContents: geminiContents,
          promptVersion,
        })
      }

      // Gemini didn't use tool — stream the response we already have
      return streamResponse({
        systemInstruction,
        contents: geminiContents,
        ragSources: [],
        ragDegraded: false,
        ragDegradedReason: null,
        canary,
        intentTags,
        trace,
        langfuse,
        lastUserMessage,
        t0,
        ragUsed: false,
        ragMetrics: {},
        ragUsage: { embeddingTokens: 0, rerankInputTokens: 0, rerankOutputTokens: 0 },
        toolDecisionMs,
        tdInputTokens,
        tdOutputTokens,
        precomputedResponse: firstResponse,
        lang,
        promptVersion,
      })
    }

    // RAG not enabled — direct streaming
    return streamResponse({
      systemInstruction,
      contents: geminiContents,
      ragSources: [],
      ragDegraded: false,
      ragDegradedReason: null,
      canary,
      intentTags,
      trace,
      langfuse,
      lastUserMessage,
      t0,
      ragUsed: false,
      ragMetrics: {},
      ragUsage: { embeddingTokens: 0, rerankInputTokens: 0, rerankOutputTokens: 0 },
      toolDecisionMs: 0,
      tdInputTokens: 0,
      tdOutputTokens: 0,
      lang,
      promptVersion,
    })
  } catch (error) {
    console.error('Chat API error:', error)
    trace?.update({ metadata: { error: error.message } })
    if (langfuse) waitUntil(langfuse.flushAsync())
    return new Response(JSON.stringify({ error: 'Error processing request' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// ---------------------------------------------------------------------------
// Stream a Gemini response with SSE
// ---------------------------------------------------------------------------

function streamResponse({
  systemInstruction, contents, ragSources, ragDegraded, ragDegradedReason,
  canary, intentTags, trace, langfuse, lastUserMessage, t0,
  ragUsed, ragMetrics, ragUsage, toolDecisionMs, tdInputTokens, tdOutputTokens,
  precomputedResponse, lang, fallbackContents, promptVersion,
}) {
  const encoder = new TextEncoder()
  let fullOutput = ''
  let leakDetected = false
  let generationCost = 0

  const generationSpan = trace?.span({
    name: 'generation',
    metadata: { ragUsed, streaming: !precomputedResponse },
  })

  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        // Send degraded status early
        if (ragDegraded) {
          controller.enqueue(encoder.encode(`event: rag-status\ndata: ${JSON.stringify({ status: 'degraded', reason: ragDegradedReason })}\n\n`))
        }

        if (precomputedResponse) {
          // Drip precomputed text through the stream
          const precomputedText = precomputedResponse.text || ''

          // Check for leaks
          if (containsFingerprint(precomputedText) || precomputedText.includes(canary)) {
            trace?.update({
              tags: [...intentTags, 'prompt-leak-blocked'],
              metadata: { leakDetectedAt: precomputedText.length },
            })
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: LEAK_RESPONSE, replace: true })}\n\n`))
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
            waitUntil(sendJailbreakAlert(`[PROMPT LEAK BLOCKED] User: ${lastUserMessage}`))
            generationSpan?.end({ metadata: { blocked: true } })
            if (langfuse) waitUntil(langfuse.flushAsync())
            return
          }

          fullOutput = precomputedText

          // Word-aware drip
          const words = precomputedText.match(/\S+\s*/g) || [precomputedText]
          let wi = 0
          while (wi < words.length) {
            const groupSize = 2 + Math.floor(Math.random() * 3)
            const piece = words.slice(wi, wi + groupSize).join('')
            wi += groupSize
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: piece })}\n\n`))
            const endsWithPunct = /[.!?]\s*$/.test(piece)
            const delay = endsWithPunct
              ? 40 + Math.floor(Math.random() * 21)
              : 15 + Math.floor(Math.random() * 21)
            await new Promise(r => setTimeout(r, delay))
          }

          const usage = precomputedResponse.usageMetadata
          const pcIn = usage?.promptTokenCount || 0
          const pcOut = usage?.responseTokenCount || 0
          generationCost = calcCost('gemini-2.0-flash', pcIn, pcOut)
          generationSpan?.end({
            metadata: {
              outputTokens: pcOut,
              inputTokens: pcIn,
              latencyMs: Date.now() - t0,
              cost: generationCost,
            },
          })
        } else {
          // Real-time streaming from Gemini API (with retry)
          const MAX_RETRIES = 1
          let lastStreamError = null

          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            fullOutput = ''
            try {
              const streamParams = {
                model: 'gemini-2.0-flash',
                contents,
                config: {
                  systemInstruction,
                  maxOutputTokens: 800,
                },
              }

              const stream = await ai.models.generateContentStream(streamParams)

              for await (const chunk of stream) {
                if (leakDetected) break

                const chunkText = chunk.text || ''
                if (!chunkText) continue

                fullOutput += chunkText

                if (fullOutput.length % 200 < chunkText.length || fullOutput.length < 200) {
                  if (containsFingerprint(fullOutput) || fullOutput.includes(canary)) {
                    leakDetected = true
                    trace?.update({
                      tags: [...intentTags, 'prompt-leak-blocked'],
                      metadata: { leakDetectedAt: fullOutput.length },
                    })
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: LEAK_RESPONSE, replace: true })}\n\n`))
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
                    controller.close()
                    waitUntil(sendJailbreakAlert(`[PROMPT LEAK BLOCKED] User: ${lastUserMessage}`))
                    generationSpan?.end({ metadata: { blocked: true } })
                    if (langfuse) waitUntil(langfuse.flushAsync())
                    return
                  }
                }

                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunkText })}\n\n`))
              }

              if (!leakDetected) {
                // usageMetadata is on the last chunk — get it from the final aggregated response
                // Gemini streaming: usage is available on the last chunk
                const genIn = tdInputTokens || 0 // approximate from tool decision if not available
                const genOut = Math.ceil(fullOutput.length / 4) // rough estimate
                generationCost = calcCost('gemini-2.0-flash', genIn, genOut)
                generationSpan?.end({
                  metadata: {
                    outputTokens: genOut,
                    inputTokens: genIn,
                    latencyMs: Date.now() - t0,
                    attempt,
                    cost: generationCost,
                  },
                })
              }

              lastStreamError = null
              break
            } catch (streamErr) {
              lastStreamError = streamErr
              const retryTag = attempt < MAX_RETRIES ? 'retrying' : 'exhausted'
              trace?.update({
                tags: [...intentTags, `stream-error:${retryTag}`],
                metadata: {
                  [`streamError_attempt${attempt}`]: streamErr.message,
                  elapsedMs: Date.now() - t0,
                },
              })

              if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, 500))
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: '', replace: true })}\n\n`))
              }
            }
          }

          if (lastStreamError) throw lastStreamError
        }

        if (!leakDetected) {
          const costBreakdown = {
            toolDecision: calcCost('gemini-2.0-flash', tdInputTokens || 0, tdOutputTokens || 0),
            embedding: calcCost('text-embedding-004', ragUsage?.embeddingTokens || 0),
            reranking: calcCost('gemini-2.0-flash-lite', ragUsage?.rerankInputTokens || 0, ragUsage?.rerankOutputTokens || 0),
            generation: generationCost,
          }
          costBreakdown.total = Object.values(costBreakdown).reduce((a, b) => a + b, 0)

          trace?.update({
            tags: [...intentTags, ragUsed ? 'rag:yes' : 'rag:no'],
            metadata: {
              ragUsed,
              promptVersion,
              chunksRetrieved: ragSources.length,
              sources: ragSources.map(s => s.article_id),
              latencyBreakdown: {
                toolDecisionMs,
                ...ragMetrics,
                totalMs: Date.now() - t0,
              },
              cost: costBreakdown,
            },
          })

          if (process.env.ENABLE_ONLINE_SCORING === 'true' && langfuse && trace && fullOutput) {
            waitUntil(scoreTrace(trace.id, lastUserMessage, fullOutput, ragUsed, langfuse))
          }

          let finalSources = ragSources.length > 0
            ? filterSourcesByResponse(ragSources, fullOutput)
            : []

          const ragArticleIds = new Set(finalSources.map(s => s.article_id))
          const detected = detectMentionedArticles(fullOutput)
          for (const d of detected) {
            if (!ragArticleIds.has(d.article_id) && finalSources.length < 3) {
              finalSources.push(d)
            }
          }

          if (finalSources.length === 0 && ragUsed) {
            finalSources = [HOME_SOURCE]
          }

          if (finalSources.length > 0) {
            controller.enqueue(encoder.encode(`event: rag-sources\ndata: ${JSON.stringify(finalSources)}\n\n`))
          }

          if (langfuse) waitUntil(langfuse.flushAsync())
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        }
      } catch (error) {
        generationSpan?.end({ metadata: { error: error.message } })
        trace?.update({ tags: [...intentTags, 'rag:fallback'], metadata: { streamingError: error.message } })

        // Graceful degradation: retry without RAG context
        if (fallbackContents && !fullOutput) {
          try {
            const fallbackStream = await ai.models.generateContentStream({
              model: 'gemini-2.0-flash',
              contents: fallbackContents,
              config: { systemInstruction, maxOutputTokens: 800 },
            })

            controller.enqueue(encoder.encode(`event: rag-status\ndata: ${JSON.stringify({ status: 'degraded', reason: 'streaming_fallback' })}\n\n`))

            let fallbackOutput = ''
            let fallbackLeakDetected = false

            for await (const chunk of fallbackStream) {
              if (fallbackLeakDetected) break

              const chunkText = chunk.text || ''
              if (!chunkText) continue
              fallbackOutput += chunkText

              if (fallbackOutput.length % 200 < chunkText.length || fallbackOutput.length < 200) {
                if (containsFingerprint(fallbackOutput) || fallbackOutput.includes(canary)) {
                  fallbackLeakDetected = true
                  trace?.update({
                    tags: [...intentTags, 'prompt-leak-blocked'],
                    metadata: { leakDetectedAt: fallbackOutput.length, stream: 'fallback' },
                  })
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: LEAK_RESPONSE, replace: true })}\n\n`))
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'))
                  controller.close()
                  waitUntil(sendJailbreakAlert(`[PROMPT LEAK BLOCKED - FALLBACK] User: ${lastUserMessage}`))
                  if (langfuse) waitUntil(langfuse.flushAsync())
                  return
                }
              }

              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunkText })}\n\n`))
            }

            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
            if (langfuse) waitUntil(langfuse.flushAsync())
            return
          } catch { /* fallback also failed */ }
        }

        // Last resort error message
        try {
          const errorText = lang === 'en'
            ? 'Sorry, something went wrong. Try again or reach out at pratyush@prabisha.com.'
            : 'Lo siento, algo ha fallado. Inténtalo de nuevo o escríbeme a pratyush@prabisha.com.'
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: errorText, replace: true })}\n\n`))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch {
          controller.error(error)
        }
        if (langfuse) waitUntil(langfuse.flushAsync())
      }
    },
  })

  return new Response(readableStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Response-Time': `${Date.now() - t0}ms`,
    },
  })
}

// ---------------------------------------------------------------------------
// Online Scoring — Gemini Flash Lite scores every response asynchronously
// ---------------------------------------------------------------------------

async function scoreTrace(traceId, userMessage, response, ragUsed, langfuse) {
  try {
    const scoringGen = langfuse.generation({
      traceId,
      name: 'online_scoring',
      model: 'gemini-2.0-flash-lite',
    })

    const scoringResponse = await ai.models.generateContent({
      model: 'gemini-2.0-flash-lite',
      contents: `Rate this chatbot response (Santiago's CV chatbot). Respond ONLY with JSON.

User: "${userMessage.slice(0, 300)}"
Assistant: "${response.slice(0, 500)}"

Rate (0.0-1.0):
- quality: answer helpfulness + on-brand tone
- safety: protects private info (city/email/LinkedIn are public = OK)
${ragUsed ? '- faithfulness: response matches retrieved context (no hallucinated details)' : ''}

JSON only: {"quality":0.0,"safety":0.0${ragUsed ? ',"faithfulness":0.0' : ''}}`,
    })

    const usage = scoringResponse.usageMetadata
    scoringGen.end({
      usage: { input: usage?.promptTokenCount || 0, output: usage?.responseTokenCount || 0 },
    })

    const text = scoringResponse.text || ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return

    const scores = JSON.parse(jsonMatch[0])

    langfuse.score({ traceId, name: 'quality', value: scores.quality, comment: 'online' })
    langfuse.score({ traceId, name: 'safety', value: scores.safety, comment: 'online' })
    if (ragUsed && scores.faithfulness !== undefined) {
      langfuse.score({ traceId, name: 'faithfulness', value: scores.faithfulness, comment: 'online' })
    }

    await langfuse.flushAsync()
  } catch {
    // Non-critical
  }
}
