import { tavily } from '@tavily/core';
import express from "express";
import {
  FOLLOWUP_PROMPT_TEMPLATE,
  FOLLOWUP_SYSTEM_PROMPT,
  PROMPT_TEMPLATE,
  SYSTEM_PROMPT,
} from './prompt';

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
    // Step 1: Get and validate the user's query.
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

    // Step 4: Search the web before asking the LLM to answer.
    const client = tavily({ apiKey: tavilyApiKey });
    const webSearchResponse = await client.search(query.trim(), {
      searchDepth: "advanced",
    });

    const webSearchResults = webSearchResponse.results;

    // Step 5: Turn search results into context for the LLM.
    // Search results are data, not instructions. The model must not follow
    // instructions that happen to appear inside a webpage.
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

    // Step 6: Tell the frontend that the sources are ready before streaming
    // the answer. This is the basic Perplexity-style flow:
    // search -> show sources -> stream answer -> generate follow-ups.
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent(
      "sources",
      webSearchResults.map((result, index) => ({
        id: index + 1,
        title: result.title,
        url: result.url,
      }))
    );

    // Step 7: Stream the answer from OpenRouter.
    // OpenRouter uses Server-Sent Events (SSE) when stream=true.
    const llmResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openRouterApiKey}`,
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        stream: true,
      }),
    });

    if (!llmResponse.ok || !llmResponse.body) {
      const errorText = await llmResponse.text();
      console.error("OpenRouter streaming error:", errorText);
      sendEvent("error", { message: "LLM request failed" });
      res.end();
      return;
    }

    const reader = llmResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    let streamFinished = false;

    while (!streamFinished) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const eventBlock of events) {
        const data = eventBlock
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");

        if (!data) {
          continue;
        }

        if (data === "[DONE]") {
          streamFinished = true;
          break;
        }

        try {
          const chunk = JSON.parse(data);
          const delta = chunk.choices?.[0]?.delta?.content;

          if (typeof delta === "string" && delta) {
            answer += delta;
            sendEvent("token", delta);
          }
        } catch (error) {
          console.error("Could not parse OpenRouter stream chunk:", error);
        }
      }
    }

    // Step 8: Generate follow-up questions after the main answer finishes.
    // This is intentionally a second, small LLM request so the answer can stream
    // immediately instead of waiting for the follow-ups.
    const followupPrompt = FOLLOWUP_PROMPT_TEMPLATE
      .replace("{{USER_QUERY}}", query.trim())
      .replace("{{ANSWER}}", answer);

    const followupResponse = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openRouterApiKey}`,
        },
        body: JSON.stringify({
          model: "openrouter/free",
          messages: [
            { role: "system", content: FOLLOWUP_SYSTEM_PROMPT },
            { role: "user", content: followupPrompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "purplexity_followups",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  followups: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: ["followups"],
                additionalProperties: false,
              },
            },
          },
        }),
      }
    );

    let followups: string[] = [];

    if (followupResponse.ok) {
      const followupData = await followupResponse.json();
      const content = followupData.choices?.[0]?.message?.content;

      if (typeof content === "string") {
        try {
          const parsed = JSON.parse(content);

          if (Array.isArray(parsed.followups)) {
            followups = parsed.followups.filter(
              (followup): followup is string => typeof followup === "string"
            );
          }
        } catch (error) {
          console.error("Could not parse follow-up response:", error);
        }
      }
    } else {
      console.error(
        "OpenRouter follow-up error:",
        await followupResponse.text()
      );
    }

    // Step 9: Tell the frontend that the whole conversation response is complete.
    sendEvent("followups", followups);
    sendEvent("done", { answer });
    res.end();
  } catch (error) {
    console.error("Conversation error:", error);

    if (!res.headersSent) {
      res.status(500).json({ error: "Something went wrong" });
      return;
    }

    res.write(
      `event: error\ndata: ${JSON.stringify({
        message: "Something went wrong",
      })}\n\n`
    );
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Purplexity backend running on http://localhost:${PORT}`);
});
