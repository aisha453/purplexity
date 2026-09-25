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

    const client = tavily({ apiKey: tavilyApiKey });

    const webSearchResponse = await client.search(query.trim(), {
      searchDepth: "advanced",
    });

    const webSearchResults = webSearchResponse.results;

    const sources = webSearchResults.map((result, index) => ({
      id: index + 1,
      title: result.title,
      url: result.url,
    }));

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

    const llmResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
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

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();

      let geminiMessage = "Gemini could not generate the answer.";

      try {
        const errorData = JSON.parse(errorText);
        geminiMessage =
          errorData?.error?.message ||
          errorData?.message ||
          geminiMessage;
      } catch {
        if (errorText.trim()) {
          geminiMessage = errorText.trim().slice(0, 500);
        }
      }

      console.error("Gemini answer error:", errorText);

      res.status(502).json({
        error: `Gemini request failed (${llmResponse.status}): ${geminiMessage}`,
      });
      return;
    }

    const llmData = await llmResponse.json();

    const answer = llmData.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? "")
      .join("")
      .trim();

    if (!answer) {
      console.error("Gemini returned no answer:", JSON.stringify(llmData));
      res.status(502).json({ error: "Gemini returned an empty answer." });
      return;
    }

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

    res.json({
      sources,
      answer,
      followups,
    });
  } catch (error) {
    console.error("Conversation error:", error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.listen(PORT, () => {
  console.log(`Purplexity backend running on http://localhost:${PORT}`);
});
