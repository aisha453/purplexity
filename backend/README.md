# backend

This backend powers the Purplexity search flow:

1. Receive a user query.
2. Search the web with Tavily.
3. Send the search context to OpenRouter.
4. Stream the answer back to the frontend with Server-Sent Events (SSE).
5. Generate follow-up questions after the answer finishes.
6. Send the source list and follow-ups through the same SSE connection.

## Install dependencies

```bash
bun install
```

## Environment variables

Copy `.env.example` to `.env` and add your API keys:

```env
TAVILY_API_KEY=your_tavily_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
```

## Run

```bash
bun run index.ts
```

The server runs on:

```
http://localhost:3000
```

Health check:

```
GET /health
```

## Conversation endpoint

```
POST /conversation
Content-Type: application/json
```

Request body:

```json
{
  "query": "What is quantum computing?"
}
```

The response is an SSE stream with these events:

- `sources` — search results shown to the frontend.
- `token` — one streamed answer fragment.
- `followups` — generated follow-up questions after the answer.
- `done` — final completion event.
- `error` — sent when the request fails after streaming has started.

The frontend can therefore render the answer while it is being generated instead of waiting
for the complete LLM response.
