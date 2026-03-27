const OpenAI = require("openai");
require("dotenv").config();

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const FREE_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free", // GPT-4 level, most reliable
  "mistralai/mistral-small-3.1-24b-instruct:free", // fast, good JSON compliance
  "google/gemma-3-27b-it:free", // Google, multimodal capable
  "nvidia/nemotron-3-super-120b-a12b:free", // 262K context, very capable
  "nousresearch/hermes-3-llama-3.1-405b:free", // best instruction following
];
// ✅ Strips markdown code fences before parsing
function extractJSON(rawText) {
  const cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

async function callWithFallback(messages) {
  for (const model of FREE_MODELS) {
    try {
      console.log(`Trying model: ${model}`);
      const completion = await client.chat.completions.create({
        model,
        messages,
      });
      return completion.choices[0].message.content;
    } catch (err) {
      if (err.status === 429 || err.status === 404) {
        // ✅ catches both
        console.log(`${model} unavailable (${err.status}), trying next...`);
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    "All free models are currently unavailable. Try again in a minute.",
  );
}
async function analyseReview(reviewText, starRating, businessName) {
  const prompt = `You are analysing a customer review for "${businessName}".

Review: "${reviewText}"
Star Rating: ${starRating} out of 5

Analyse the review content deeply — do NOT rely only on the star rating.
A 1-star spam review is different from a 1-star describing a real incident.

Return ONLY a valid JSON object, no explanation, no markdown, no code fences:
{
  "sentiment": "critical | negative | neutral | positive | exceptional",
  "route": "hold | senior | standard | celebrate",
  "confidence": "high | medium | low",
  "summary": "one sentence explaining your classification",
  "is_spam": true or false,
  "draft_reply": "a warm, professional reply as the business owner (empty string if route is hold)"
}

Routing rules:
- 1 star + serious complaint → route: "hold", draft_reply: ""
- 1 star + spam/irrelevant → route: "senior", draft_reply: "polite response"
- 2 stars → route: "senior"
- 3 or 4 stars → route: "standard"
- 5 stars → route: "celebrate"`;

  const result = await callWithFallback([{ role: "user", content: prompt }]);
  return extractJSON(result); // ✅ safe parse
}

module.exports.callWithFallback = callWithFallback;
module.exports.analyseReview = analyseReview;

function createApp() {
  const express = require("express");
  const app = express();

  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  app.post("/api/analyze-review", async (req, res) => {
    const { reviewText, starRating, businessName } = req.body;
    if (!reviewText || starRating === undefined || !businessName) {
      return res.status(400).json({
        error: "Fields reviewText, starRating, businessName are required.",
      });
    }

    try {
      const analysis = await analyseReview(
        reviewText,
        starRating,
        businessName,
      );
      return res.json({ success: true, analysis });
    } catch (err) {
      console.error("Error in /api/analyze-review", err);
      return res
        .status(500)
        .json({ error: err.message || "Internal server error" });
    }
  });

  app.post("/api/generate-reply", async (req, res) => {
    const { reviewText, starRating, businessName } = req.body;
    if (!reviewText || starRating === undefined || !businessName) {
      return res.status(400).json({
        error: "Fields reviewText, starRating, businessName are required.",
      });
    }

    try {
      const analysis = await analyseReview(
        reviewText,
        starRating,
        businessName,
      );
      const reply =
        analysis.route === "hold"
          ? "Requires senior review before auto-reply"
          : analysis.draft_reply || "";
      return res.json({ success: true, analysis, reply });
    } catch (err) {
      console.error("Error in /api/generate-reply", err);
      return res
        .status(500)
        .json({ error: err.message || "Internal server error" });
    }
  });

  return app;
}

async function startServer() {
  const app = createApp();
  const PORT = process.env.PORT || 3000;

  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log("Routes:");
    console.log("  GET /api/health");
    console.log("  POST /api/analyze-review");
    console.log("  POST /api/generate-reply");
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Error: Port ${PORT} is already in use. Try using a different PORT or stop the running process.`,
      );
      console.error("Suggested commands:");
      console.error(`  lsof -i :${PORT}  # Mac/Linux`);
      console.error(`  netstat -ano | findstr :${PORT}  # Windows`);
      console.error("  taskkill /PID <pid> /F  # Windows");
      process.exit(1);
    }
    console.error("Unknown server error", err);
    process.exit(1);
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error("Failed to start server", err);
    process.exit(1);
  });
}

module.exports = {
  callWithFallback,
  analyseReview,
  createApp,
};
