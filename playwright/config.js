"use strict";

require("dotenv").config();

module.exports = {
  // ── Google credentials ────────────────────────────────────────────────────
  GOOGLE_EMAIL: process.env.GOOGLE_EMAIL || "",
  GOOGLE_PASSWORD: process.env.GOOGLE_PASSWORD || "",

  // ── GMB target ───────────────────────────────────────────────────────────
  // Leave blank to pick the first/only location automatically.
  // Set to the exact name shown in Business Profile Manager if you have multiple.
  GMB_BUSINESS_NAME: process.env.GMB_BUSINESS_NAME || "",

  // ── Playwright browser options ────────────────────────────────────────────
  HEADLESS: process.env.PLAYWRIGHT_HEADLESS !== "false", // default: headless
  SLOW_MO: parseInt(process.env.PLAYWRIGHT_SLOW_MO || "0", 10), // ms between actions

  // ── Timing (ms) ──────────────────────────────────────────────────────────
  NAVIGATION_TIMEOUT: 60_000,
  ACTION_TIMEOUT: 30_000,
  REPLY_DELAY: 2_000, // pause between posting each reply

  // ── URLs ─────────────────────────────────────────────────────────────────
  GOOGLE_LOGIN_URL: "https://accounts.google.com/signin",
  GMB_DASHBOARD_URL: "https://business.google.com/reviews",

  // ── Dry-run mode ─────────────────────────────────────────────────────────
  // When true, replies are generated but NOT submitted. Great for testing.
  DRY_RUN: process.env.DRY_RUN === "true",
};
