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
const GEMINI_MODEL = "gemini-3.1-flash-lite";

app.use(express.json());

// Allow the frontend to call the backend during local development.
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

    const tavilyApiKey = process.env.TAVILY_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!tavilyApiKey) {
      res.status(500).json({ error: "TAVILY_API_KEY is not configured" });
      return;
    }

    if (!geminiApiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
      return;
    }

    // Step 2: Search the web before asking Gemini to answer.
    const client = tavily({ apiKey: tavilyApiKey });
    const webSearchResponse = await client.search(query.trim(), {
      searchDepth: "advanced",
    });

    const webSearchResults = webSearchResponse.results;

    // Step 3: Turn search results into context for Gemini.
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

    // Step 4: Start the SSE response so the frontend can receive
    // sources and streamed answer tokens.
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

    // Step 5: Stream the answer directly from the Gemini API.
    // The free-tier Gemini 3.1 Flash-Lite model is used here.
    const llmResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiApiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
        }),
      }
    );

    if (!llmResponse.ok || !llmResponse.body) {
      const errorText = await llmResponse.text();
      console.error("Gemini streaming error:", errorText);
      sendEvent("error", { message: "Gemini request failed" });
      res.end();
      return;
    }

    const reader = llmResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";

    while (true) {
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

        try {
          const chunk = JSON.parse(data);
          const parts = chunk.candidates?.[0]?.content?.parts ?? [];

          for (const part of parts) {
            if (typeof part.text === "string" && part.text) {
              answer += part.text;
              sendEvent("token", part.text);
            }
          }
        } catch (error) {
          console.error("Could not parse Gemini stream chunk:", error);
        }
      }
    }

    // Step 6: Generate follow-up questions with the same free Gemini model.
    const followupPrompt = FOLLOWUP_PROMPT_TEMPLATE
      .replace("{{USER_QUERY}}", query.trim())
      .replace("{{ANSWER}}", answer);

    const followupResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiApiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: FOLLOWUP_SYSTEM_PROMPT }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: followupPrompt }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                followups: {
                  type: "ARRAY",
                  items: {
                    type: "STRING",
                  },
                },
              },
              required: ["followups"],
            },
          },
        }),
      }
    );

    let followups: string[] = [];

    if (followupResponse.ok) {
      const followupData = await followupResponse.json();
      const content = followupData.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text ?? "")
        .join("");

      if (typeof content === "string") {
        try {
          const parsed = JSON.parse(content);

          if (Array.isArray(parsed.followups)) {
            followups = parsed.followups.filter(
              (followup: unknown): followup is string =>
                typeof followup === "string"
            );
          }
        } catch (error) {
          console.error("Could not parse Gemini follow-up response:", error);
        }
      }
    } else {
      console.error(
        "Gemini follow-up error:",
        await followupResponse.text()
      );
    }

    // Step 7: Tell the frontend that the whole response is complete.
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
