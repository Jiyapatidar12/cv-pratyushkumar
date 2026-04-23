# santifer.io — Project Overview

> Santiago Fernández ka interactive portfolio jo ek production-grade AI chatbot ke saath aata hai.
> Static CV ki jagah yeh site khud apni engineering skills ko demonstrate karti hai.

---

## Yeh Project Kya Hai?

Ek **interactive portfolio website** jo sirf resume nahi hai — balki ek live technical showcase hai.
Site pe ek AI chatbot "Santi" hai jo Santiago ke baare mein puchhe gaye sawaalon ka jawab deta hai,
voice mode support karta hai, aur puri LLMOps observability ke saath production mein chal raha hai.

Live site: [santifer.io](https://santifer.io)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript |
| Build Tool | Vite 7 + SWC |
| Styling | Tailwind CSS v4 |
| Animations | Motion (framer-motion) |
| Routing | React Router v7 |
| AI (Text) | Google Gemini 2.5 Flash (streaming SSE) |
| AI (Voice) | OpenAI Realtime API (audio-to-audio) |
| Vector DB | Supabase (pgvector + BM25 hybrid search) |
| Observability | Langfuse (LLM tracing + scoring) |
| Deployment | Vercel Edge Runtime |
| Email Alerts | Resend |

---

## Project Structure

```
santifer.io/
├── src/
│   ├── App.tsx                  # Main CV/portfolio page
│   ├── FloatingChat.tsx         # Text chatbot widget (streaming SSE)
│   ├── useVoiceMode.ts          # OpenAI Realtime WebSocket hook
│   ├── VoiceOrb.tsx             # Voice mode UI
│   ├── articles/                # 6 case studies + article registry
│   ├── ops/                     # LLMOps dashboard (private /ops route)
│   └── i18n.ts                  # Bilingual (ES/EN) translations
│
├── api/
│   ├── chat.js                  # Main chatbot edge function
│   ├── voice-token.js           # OpenAI Realtime ephemeral token + rate limiting
│   ├── rag-search.js            # RAG search for voice function calling
│   ├── voice-trace.js           # Voice session tracing
│   ├── _shared/
│   │   ├── rag.js               # Hybrid search, reranking, cost tracking
│   │   ├── prompt.js            # Langfuse prompt versioning
│   │   └── ops-auth.js          # Dashboard authentication
│   └── ops/                     # Dashboard API endpoints (7 routes)
│
├── evals/
│   ├── datasets/                # 10 JSON files, 71 test cases
│   ├── assertions.ts            # Deterministic checks
│   ├── llm-judge.ts             # LLM-as-Judge scoring
│   └── runner.ts                # Test orchestration
│
├── scripts/                     # Build-time scripts (RAG sync, sitemap, prerender, etc.)
├── docs/                        # Architecture Decision Records
├── public/                      # Static assets, images, fonts
└── chatbot-prompt.txt           # Fallback system prompt
```

---

## Key Features

### 1. AI Chatbot "Santi" (Text Mode)
- Claude Sonnet se powered, streaming word-by-word response
- Pehle person mein Santiago ki tarah baat karta hai
- Agentic RAG: Gemini khud decide karta hai ki search chahiye ya nahi
- Hybrid search: pgvector (semantic) + BM25 (keyword) Supabase mein
- Gemini Flash Lite se reranking (top-10 → top-5)

### 2. Voice Mode
- OpenAI Realtime API se audio-to-audio conversation
- Shared RAG pipeline text mode ke saath
- Function calling se portfolio search
- ~$0.25 per session cost

### 3. Chatbot Pipeline (api/chat.js)

```
User message
  → Input validation + intent classification
  → System prompt (Langfuse registry ya file fallback)
  → Gemini 2.5 Flash (tool_use decision)
  → Agentic RAG (agar zaroorat ho):
      ├── OpenAI embeddings (text-embedding-3-small)
      ├── Supabase hybrid search (pgvector + BM25)
      └── Gemini Flash Lite (reranking)
  → Gemini 2.5 Flash (streaming generation)
  → Langfuse tracing (har span ka cost track)
  └── waitUntil → Haiku scoring (0ms added latency)
```

### 4. 6-Layer Security Defense
| Layer | Kya karta hai |
|-------|--------------|
| Keyword Detection | Jailbreak patterns detect karta hai |
| Canary Tokens | Random UUID inject karta hai prompt mein |
| Fingerprinting | Prompt leak detect karta hai |
| Anti-Extraction | Response filtering |
| Online Safety Scoring | Gemini Flash Lite se async scoring |
| Adversarial Red Team | 20+ auto-generated attacks |

Jailbreak attempt pe real-time email alert (Resend se).

### 5. 71 Automated Evals (CI Gate)

Har push pe 71 tests run hote hain — fail hone pe deploy block ho jaata hai.

| Category | Tests |
|----------|-------|
| Factual Accuracy | 9 |
| Persona Adherence | 4 |
| Boundary Testing | 7 |
| Response Quality | 7 |
| Safety/Jailbreak | 7 |
| Language Handling | 5 |
| RAG Quality | 16 |
| Multi-turn | 5 |
| Source Badges | 5 |
| Voice Quality | 6 |

### 6. LLMOps Dashboard (/ops)
Password-protected private dashboard, 8 tabs:

| Tab | Kya dikhata hai |
|-----|----------------|
| Overview | KPIs, timelines, intent distribution |
| Conversations | Filter + detail with spans, cost, latency |
| Costs | Breakdown per component |
| RAG | Activation rate, chunks per article |
| Security | Defense funnel, jailbreak list |
| Evals | Pass rates by category |
| Voice | Sessions, latency P50/P95, cost/min |
| System | Prompt versions, RAG stats, model pricing |

### 7. Closed-Loop System
```
Production trace
  → Online scoring (Haiku)
  → Quality < 0.7?
      → Auto-generate test case
      → CI gate blocks next deploy
```
Failures automatically tests ban jaate hain — regression prevent hoti hai.

### 8. Content & SEO
- 6 bilingual case studies (ES/EN), prerendered HTML
- JSON-LD structured data (Article, TechArticle)
- Sitemap auto-generation at build time
- `llms.txt` for AI crawlers (GEO-ready)
- Interactive architecture diagram (GSAP-animated SVG, narrated audio)

---

## Build Pipeline

```bash
npm run build
```

Yeh sab steps run karta hai:
1. `rag:sync` — Articles ko chunks mein export karo, Supabase mein ingest karo
2. `prompt:sync` — System prompt Langfuse mein sync karo
3. `embed-evals` — Eval datasets embed karo
4. Stats updates — Reddit, GitHub, Twitter stats fetch karo
5. `tsc` — TypeScript compile karo
6. `vite build` — Frontend bundle banao
7. `generate-sitemap` — sitemap.xml banao
8. `validate-articles` — Article schema validate karo
9. `prerender` — SSR + critical CSS inline karo
10. `indexnow-ping` — Search engines ko notify karo

---

## Cost Model

| Item | Cost |
|------|------|
| Text conversation | < $0.005 |
| Voice session | ~$0.25 |
| Infrastructure | $0 (free tiers) |
| 200 conversations/day | ~$30/month |

---

## Useful Commands

```bash
npm run dev              # Local dev server
npm run evals            # 71 tests run karo
npm run adversarial      # Red team attacks
npm run chats            # Langfuse se conversations dekho
npm run prompt:regression # Prompt versions compare karo
npm run test:contract    # Trace metadata validate karo (67 tests)
npm run test:ops         # Dashboard API test karo (102 tests)
npm run diagnose:rag     # RAG pipeline debug karo
```

---

## Environment Variables

`.env.local.example` file mein sab variables listed hain. Key ones:

- `GEMINI_API_KEY` — Gemini ke liye (aistudio.google.com)
- `OPENAI_API_KEY` — Embeddings + Voice ke liye
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — Vector DB ke liye
- `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` — Observability ke liye
- `OPS_PASSWORD` — Dashboard auth ke liye
- `RESEND_API_KEY` — Jailbreak email alerts ke liye

---

## Summary

Yeh project ek "living resume" hai — jo sirf skills list nahi karta, balki unhe live demonstrate karta hai.
Ek full-stack AI application hai jisme production-grade observability, security, testing, aur cost tracking sab kuch hai.
