import {
  buildCostOptimizationPrompt,
} from "./prompts.js";

export async function optimizeGitHubCosts(data) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY is missing."
    );
  }

  const OPENROUTER_URL = process.env.OPENROUTER_URL;
  const MODEL = process.env.OPENROUTER_MODEL;

  if (!OPENROUTER_URL) {
    throw new Error(
      "OPENROUTER_URL is missing."
    );
  }

  if (!MODEL) {
    throw new Error(
      "OPENROUTER_MODEL is missing."
    );
  }

  const jobs = Array.isArray(data.jobs)
    ? data.jobs
    : [];

  const totalCost = jobs.reduce(
    (total, job) =>
      total +
      Number(job.estimatedCost || 0),
    0
  );

  const prompt =
    buildCostOptimizationPrompt({
      repository:
        data.repository || "Unknown",

      totalCost,

      jobs,
    });

  const response = await fetch(
    OPENROUTER_URL,
    {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${process.env.OPENROUTER_API_KEY}`,

        "Content-Type":
          "application/json",

        "HTTP-Referer":
          "https://github.com",

        "X-OpenRouter-Title":
          "GitHub Cost Analyzer",
      },

      body: JSON.stringify({
        model: MODEL,

        messages: [
          {
            role: "system",

            content:
              "You are a GitHub Actions cost optimization expert. You MUST output ONLY valid raw JSON. Do NOT include any thinking process, introduction, explanation, markdown formatting, or conversational text. Start directly with '{' and end with '}'.",
          },

          {
            role: "user",

            content: prompt,
          },
        ],

        temperature: 0.1,

        max_tokens: 4000,

        response_format: {
          type: "json_object",
        },
      }),
    }
  );

  if (!response.ok) {
    const error =
      await response.text();

    throw new Error(
      `OpenRouter error ${response.status}: ${error}`
    );
  }

  const responseData =
    await response.json();

  const content =
    responseData
      ?.choices?.[0]
      ?.message
      ?.content;

  if (!content) {
    throw new Error(
      "OpenRouter returned no content."
    );
  }

  let result;
  let cleanContent = content.trim();
  const firstBrace = cleanContent.indexOf("{");
  const lastBrace = cleanContent.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleanContent = cleanContent.substring(firstBrace, lastBrace + 1);
  }

  try {
    result = JSON.parse(cleanContent);
  } catch (err) {
    console.error("❌ Failed to parse JSON from AI response.");
    console.error("Raw content:", content);
    throw new Error(
      `AI returned invalid JSON: ${err.message}`
    );
  }

  return {
    currentCost:
      Number(totalCost.toFixed(2)),

    estimatedSavings:
      Number(
        result.estimatedSavings
      ) || 0,

    savingsPercentage:
      Number(
        result.savingsPercentage
      ) || 0,

    summary:
      result.summary || "",

    issues:
      Array.isArray(result.issues)
        ? result.issues
        : [],

    recommendations:
      Array.isArray(
        result.recommendations
      )
        ? result.recommendations
        : [],
  };
}