/**
 * RAG Ingestion: embed chunks and upsert to Supabase pgvector.
 * Gemini text-embedding-004 (768 dims, free) + Gemini Flash Lite contextual retrieval.
 * Requires: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { GoogleGenAI } from '@google/genai'
import { createClient } from '@supabase/supabase-js'
import { articleRegistry } from '../src/articles/registry.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const CHUNKS_DIR = resolve(root, 'scripts/chunks')
const HASHES_FILE = resolve(root, '.rag-hashes.json')
const MAX_CHUNK_SIZE = 1000
const CHUNK_OVERLAP = 200

function getGemini() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required')
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

interface ChunkMetadata {
  article_id: string; article_slug_en: string; article_slug_es: string
  section_id: string; section_anchor: string; page_path_en: string
  page_path_es: string; source_file: string; format: string
}
interface Chunk { content: string; metadata: ChunkMetadata }

function loadHashesFromFile(): Record<string, string> {
  try { if (existsSync(HASHES_FILE)) return JSON.parse(readFileSync(HASHES_FILE, 'utf-8')) } catch {}
  return {}
}

async function loadHashesFromSupabase(supabase: ReturnType<typeof createClient>): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.from('rag_hashes').select('article_id, hash')
    if (!data) return {}
    return Object.fromEntries(data.map((r: any) => [r.article_id, r.hash]))
  } catch { return {} }
}

async function loadHashes(supabase: ReturnType<typeof createClient>) {
  const local = loadHashesFromFile()
  if (Object.keys(local).length > 0) return local
  return loadHashesFromSupabase(supabase)
}

async function saveHashes(hashes: Record<string, string>, supabase: ReturnType<typeof createClient>) {
  writeFileSync(HASHES_FILE, JSON.stringify(hashes, null, 2))
  try {
    const rows = Object.entries(hashes).map(([article_id, hash]) => ({ article_id, hash }))
    await supabase.from('rag_hashes').upsert(rows, { onConflict: 'article_id' })
  } catch {}
}

function hashContent(chunks: Chunk[]) {
  return createHash('sha256').update(JSON.stringify(chunks)).digest('hex').slice(0, 16)
}

function splitChunk(chunk: Chunk): Chunk[] {
  if (chunk.content.length <= MAX_CHUNK_SIZE) return [chunk]
  const parts: Chunk[] = []
  let start = 0
  while (start < chunk.content.length) {
    const end = Math.min(start + MAX_CHUNK_SIZE, chunk.content.length)
    parts.push({ content: chunk.content.slice(start, end), metadata: { ...chunk.metadata } })
    start = end - CHUNK_OVERLAP
    if (start >= chunk.content.length - CHUNK_OVERLAP) break
  }
  return parts
}

async function addContextualSummaries(chunks: Chunk[], articleTitle: string, ai: GoogleGenAI): Promise<string[]> {
  const enriched: string[] = []
  for (const chunk of chunks) {
    try {
      const r = await ai.models.generateContent({
        model: 'gemini-2.0-flash-lite',
        contents: `Article: "${articleTitle}", section: "${chunk.metadata.section_id}". Write 1-2 sentences summarizing what this chunk contains to help with retrieval.\n\nChunk:\n${chunk.content.slice(0, 500)}`,
        config: { maxOutputTokens: 100 },
      })
      const summary = r.text || ''
      enriched.push(summary ? `${summary}\n\n${chunk.content}` : chunk.content)
    } catch { enriched.push(chunk.content) }
  }
  return enriched
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const results: number[][] = []
  for (const text of texts) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'models/text-embedding-004', content: { parts: [{ text }] } }) }
    )
    if (!res.ok) throw new Error(`Gemini embedding failed: ${res.status}`)
    const data = await res.json() as { embedding: { values: number[] } }
    results.push(data.embedding.values)
  }
  return results
}

async function deleteArticleChunks(supabase: ReturnType<typeof createClient>, articleId: string) {
  const { error } = await supabase.rpc('delete_documents_by_slug', { slug: articleId })
  if (error) await supabase.from('documents').delete().eq('metadata->>article_id', articleId)
}

async function insertChunks(supabase: ReturnType<typeof createClient>, chunks: Chunk[], embeddings: number[][], enrichedTexts: string[]) {
  const rows = chunks.map((c, i) => ({ content: enrichedTexts[i], metadata: c.metadata, embedding: embeddings[i] }))
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await supabase.from('documents').insert(rows.slice(i, i + 50))
    if (error) throw error
  }
}

async function main() {
  console.log('RAG Ingestion starting...\n')

  if (!process.env.GEMINI_API_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('Missing env vars. Skipping RAG ingestion.')
    process.exit(0)
  }

  const ai = getGemini()
  const supabase = getSupabase()
  const hashes = await loadHashes(supabase)
  const newHashes = { ...hashes }

  if (!existsSync(CHUNKS_DIR)) { console.log('No chunks dir. Run rag:export first.'); process.exit(0) }

  const chunkFiles = readdirSync(CHUNKS_DIR).filter(f => f.endsWith('.json'))
  let totalIngested = 0, totalSkipped = 0

  for (const file of chunkFiles) {
    const articleId = basename(file, '.json')
    const article = articleRegistry.find(a => a.id === articleId)
    if (article && !article.ragReady) { totalSkipped++; continue }

    const chunks: Chunk[] = JSON.parse(readFileSync(resolve(CHUNKS_DIR, file), 'utf-8'))
    if (!chunks.length) continue

    const hash = hashContent(chunks)
    if (hashes[articleId] === hash) { console.log(`  skip ${articleId}`); totalSkipped++; continue }

    console.log(`  ${articleId} — ${chunks.length} chunks`)
    const split = chunks.flatMap(splitChunk)
    const enriched = await addContextualSummaries(split, article?.titles.en || articleId, ai)
    const embeddings = await embedTexts(enriched)
    await deleteArticleChunks(supabase, articleId)
    await insertChunks(supabase, split, embeddings, enriched)
    newHashes[articleId] = hash
    totalIngested += split.length
    console.log(`  done ${articleId} — ${split.length} chunks`)
  }

  for (const articleId of Object.keys(newHashes)) {
    if (!chunkFiles.map(f => basename(f, '.json')).includes(articleId)) {
      await deleteArticleChunks(supabase, articleId)
      delete newHashes[articleId]
    }
  }

  await saveHashes(newHashes, supabase)
  console.log(`\nDone: ${totalIngested} ingested, ${totalSkipped} skipped`)
}

main().catch(err => { console.error('Ingestion failed:', err.message); process.exit(1) })
