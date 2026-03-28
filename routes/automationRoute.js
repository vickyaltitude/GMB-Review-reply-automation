"use strict";

/**
 * routes/automationRoute.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Adds a POST /api/automate-replies endpoint to your existing Express server.
 *
 * Mount in server.js:
 *   const automationRoute = require('./routes/automationRoute');
 *   app.use('/api', automationRoute);
 *
 * Then trigger with:
 *   POST http://localhost:3000/api/automate-replies
 *   Body (optional): { "dryRun": true }
 * ─────────────────────────────────────────────────────────────────────────────
 */

const express = require("express");
const router = express.Router();
const { runGMBAutomation } = require("../playwright/gmbAutomation");

// ── LLM reply generator (reuse whatever you already have in utils/) ───────────
// Adjust this import to point at your actual LLM function.
// It must be: async (reviewText: string, reviewerName: string, rating: number) => string
let generateReply;
try {
  const llm = require("../utils/llmHelper");
  generateReply = llm.generateReply || llm.default;
} catch {
  // Inline fallback using Anthropic SDK (mirrors what your server likely does)
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic();

  generateReply = async (reviewText, reviewerName, rating) => {
    const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
    const sentiment =
      rating >= 4 ? "positive" : rating === 3 ? "neutral" : "negative";

    const message = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content:
            `You are a professional business owner responding to a Google review.\n` +
            `Reviewer: ${reviewerName}\n` +
            `Rating: ${stars} (${rating}/5 – ${sentiment})\n` +
            `Review: "${reviewText}"\n\n` +
            `Write a warm, professional, concise reply (2-4 sentences). ` +
            `Do NOT use placeholders. Do NOT start with "Dear" or "Hello". ` +
            `Just write the reply text.`,
        },
      ],
    });

    return message.content[0].text.trim();
  };
}

// ── Route ─────────────────────────────────────────────────────────────────────

let isRunning = false; // prevent concurrent runs

router.post("/automate-replies", async (req, res) => {
  if (isRunning) {
    return res.status(409).json({
      success: false,
      message: "An automation run is already in progress. Please wait.",
    });
  }

  const dryRun = req.body?.dryRun === true;
  if (dryRun) process.env.DRY_RUN = "true";
  else delete process.env.DRY_RUN;

  isRunning = true;
  const startedAt = new Date().toISOString();

  // Respond immediately – automation runs in background
  res.status(202).json({
    success: true,
    message: `GMB automation started${dryRun ? " (dry-run mode)" : ""}. Check server logs for progress.`,
    startedAt,
  });

  try {
    const stats = await runGMBAutomation({ generateReply });
    console.log(
      `[AutomationRoute] Finished at ${new Date().toISOString()}`,
      stats,
    );
  } catch (e) {
    console.error("[AutomationRoute] Automation failed:", e.message);
  } finally {
    isRunning = false;
    if (dryRun) delete process.env.DRY_RUN;
  }
});

/** Optional: GET to check if automation is currently running */
router.get("/automate-replies/status", (_req, res) => {
  res.json({ running: isRunning });
});

module.exports = router;
