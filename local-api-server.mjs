/**
 * Local API server for testing chatbot without Vercel
 * Run: node local-api-server.mjs
 * Then in another terminal: npm run dev
 */

import { createServer } from 'http'
import { readFileSync } from 'fs'
import { GoogleGenAI } from '@google/genai'

// Load env
const env = readFileSync('.env.local', 'utf8')
for (const line of env.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const idx = trimmed.indexOf('=')
  if (idx === -1) continue
  const key = trimmed.slice(0, idx).trim()
  const val = trimmed.slice(idx + 1).trim().replace(/^['"`]|['"`]$/g, '')
  process.env[key] = val
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
const SYSTEM_PROMPT = readFileSync('chatbot-prompt.txt', 'utf8')
const PORT = 3001

const server = createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { messages, lang } = JSON.parse(body)
        const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || ''

        const langInstruction = lang === 'en'
          ? `The user is browsing in English. You MUST respond in English. Contact email: pratyush@prabisha.com`
          : `The user is browsing in English. You MUST respond in English. Contact email: pratyush@prabisha.com`

        const systemInstruction = `${SYSTEM_PROMPT}\n\n${langInstruction}`

        const contents = messages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: typeof m.content === 'string' ? m.content : 'Hello' }],
        }))

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })

        const stream = await ai.models.generateContentStream({
          model: 'gemini-2.0-flash',
          contents,
          config: { systemInstruction, maxOutputTokens: 800 },
        })

        for await (const chunk of stream) {
          const text = chunk.text || ''
          if (text) {
            res.write(`data: ${JSON.stringify({ text })}\n\n`)
          }
        }

        res.write('data: [DONE]\n\n')
        res.end()
      } catch (err) {
        console.error('Error:', err.message)
        res.write(`data: ${JSON.stringify({ text: 'Sorry, something went wrong. Please try again.' })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
      }
    })
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`\n✅ Local API server running at http://localhost:${PORT}`)
  console.log('   Now run "npm run dev" in another terminal')
  console.log('   Chatbot will work at http://localhost:5173\n')
})
