import { tavily } from '@tavily/core';
import express from "express";
import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from './prompt';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// Allow the frontend to call the backend during local development.
// TODO: Replace "*" with the deployed frontend URL when authentication is added.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", process.env.FRONTEND_URL || "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/conversation", async (req, res) => {
  try {
    // Step 1: Get the query from the user.
    const query = req.body?.query;

    if (typeof query !== "string" || !query.trim()) {
      res.status(400).json({ error: "query is required" });
      return;
    }

    // API keys are checked here so the server can still start and expose /health
    // even when the local environment has not been configured yet.
    const tavilyApiKey = process.env.TAVILY_API_KEY;
    const openRouterApiKey = process.env.OPENROUTER_API_KEY;

    if (!tavilyApiKey) {
      res.status(500).json({ error: "TAVILY_API_KEY is not configured" });
      return;
    }

    if (!openRouterApiKey) {
      res.status(500).json({ error: "OPENROUTER_API_KEY is not configured" });
      return;
    }

    // Step 2: Make sure user has access/credits to hit the endpoint.
    // TODO: Add authentication, rate limits, and credit checks.

    // Step 3(TODO): Check if we have web search indexed for a similar query.

    // Step 4: Perform web search to gather resources.
    const client = tavily({ apiKey: tavilyApiKey });
    const webSearchResponse = await client.search(query.trim(), {
      searchDepth: "advanced",
    });

    const webSearchResults = webSearchResponse.results;

    // Step 5: Do some context engineering on the prompt + web search responses.
    // Search results are data, not instructions. The model should not follow
    // instructions that may appear inside a search result.
    const formattedResults = webSearchResults
      .map(
        (result, index) =>
          `[Source ${index + 1}]
Title: ${result.title ?? ""}
URL: ${result.url ?? ""}
Content: ${result.content ?? ""}`
      )
      .join("\n\n");

    const prompt = PROMPT_TEMPLATE
      .replace("{{WEB_SEARCH_RESULTS}}", formattedResults)
      .replace("{{USER_QUERY}}", query.trim());

    // Step 6: Hit the LLM.
    // TODO: Stream the response to the client once the basic request flow is stable.
    const llmResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openRouterApiKey}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-5.4",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "purplexity_response",
            strict: true,
            schema: {
              type: "object",
              properties: {
                answer: { type: "string" },
                followups: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["answer", "followups"],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      console.error("OpenRouter error:", errorText);
      res.status(502).json({ error: "LLM request failed" });
      return;
    }

    const llmData = await llmResponse.json();
    const content = llmData.choices?.[0]?.message?.content;

    if (typeof content !== "string") {
      res.status(502).json({ error: "LLM returned an invalid response" });
      return;
    }

    let parsedResponse: {
      answer?: unknown;
      followups?: unknown;
    };

    try {
      parsedResponse = JSON.parse(content);
    } catch {
      res.status(502).json({ error: "LLM returned invalid JSON" });
      return;
    }

    // Step 7: Also return the sources and follow-up questions.
    res.json({
      answer:
        typeof parsedResponse.answer === "string"
          ? parsedResponse.answer
          : "",
      followups: Array.isArray(parsedResponse.followups)
        ? parsedResponse.followups.filter(
            (followup): followup is string => typeof followup === "string"
          )
        : [],
      sources: webSearchResults.map((result, index) => ({
        id: index + 1,
        title: result.title,
        url: result.url,
      })),
    });

    // Step 8: Close the request.
  } catch (error) {
    console.error("Conversation error:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.listen(PORT, () => {
  console.log(`Purplexity backend running on http://localhost:${PORT}`);
});
