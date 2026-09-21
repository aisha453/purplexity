import {tavily} from '@tavily/core';
import express from "express";
import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from './prompt';
import { z } from 'zod';
const client = tavily({ apiKey: process.env.TAVILY_API_KEY });
const app = express()
app.use(express.json());
app.post("conversation", async(req, res) => {

  // Step 1: Get the query from the user
   const query = req.body.query;///give me the best rust resources => rust resources
  // Step 2: Make sure user has access/credits to hit the endpoint

  // Step 3(TODO): Check if we have web search indexed for a similar query

  // Step 4: Perform web search to gather resources
  const WebSearchResponse = await client.search(query, {
    searchDepth: "advanced"
});
const webSearchResults = WebSearchResponse.results;

  // Step 5: Do some context engineering on the prompt + web search responses

  // Step 6: Hit the LLM and stream back the response
  // hit the llm? llm api/openrouter/vercel ai gateway

  const prompt = PROMPT_TEMPLATE.replace("{{WEB_SEARCH_RESULTS}}", webSearchResults.join("\n")).replace("{{USER_QUERY}}", query);
  const result = streamText({
    model: 'openai/gpt-5.4',
    prompt: prompt,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    output: Output.object({
    schema: z.object({
    followups : z.array(z.string()),
    answer: z.string()
  }),
})
  });
for await (const textPart of result.textStream) {
    process.stdout.write(textPart);
  // Step 7: Also stream back the sources and the follow up questions(which we can get from another parallel LLM call)
 // Step 8: Close the event stream
    function streamText(arg0: { model: string; prompt: string; SYSTEM_PROMPT: string; }) {
        throw new Error('Function not implemented.');
    }
});
app.listen(3000)