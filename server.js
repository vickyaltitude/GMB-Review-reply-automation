require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");

// Set up Vertex AI client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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
  // messages: [{role: 'user', content: '...'}]
  const userMessage = messages.find((m) => m.role === "user");
  if (!userMessage) throw new Error("No user message provided");
  try {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      contents: userMessage.content,
      config: { responseMimeType: "application/json" },
    });
    // Vertex returns result.candidates[0].content.parts[0].text
    return response.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (err) {
    console.error("Vertex AI call failed", err);
    throw new Error("Vertex AI LLM call failed: " + (err.message || err));
  }
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
    const authKey = req.headers["authorization"];
    if (authKey !== `Bearer ${process.env.API_AUTH_KEY}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
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
    const authKey = req.headers["authorization"];
    if (authKey !== `Bearer ${process.env.API_AUTH_KEY}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
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
