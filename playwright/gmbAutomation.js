"use strict";

/**
 * gmbAutomation.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Playwright automation that:
 *   1. Logs into Google (or restores a saved session)
 *   2. Opens Google Business Profile Manager → Reviews tab
 *   3. Collects all reviews that have NO reply yet
 *   4. Calls your existing LLM util to generate a reply for each
 *   5. Types and submits the reply on the page
 *
 * Usage (standalone):
 *   node playwright/gmbAutomation.js
 *
 * Usage (from server.js / API route):
 *   const { runGMBAutomation } = require('./playwright/gmbAutomation');
 *   await runGMBAutomation({ generateReply });   // pass your LLM function
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { chromium } = require("playwright");
const { saveSession, loadSession, clearSession } = require("./sessionManager");
const cfg = require("./config");

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[GMB-Bot] ${msg}`);
}
function warn(msg) {
  console.warn(`[GMB-Bot] ⚠  ${msg}`);
}
function err(msg) {
  console.error(`[GMB-Bot] ✖ ${msg}`);
}

/** Wait for a selector; return null instead of throwing if absent. */
async function find(page, selector, timeout = 8_000) {
  try {
    return await page.waitForSelector(selector, { timeout });
  } catch {
    return null;
  }
}

/** Human-like typing with a small random delay between keystrokes. */
async function typeHuman(locator, text) {
  await locator.click();
  await locator.fill(""); // clear first
  await locator.pressSequentially(text, { delay: 60 + Math.random() * 60 });
}

// ── Step 1: Google Login ──────────────────────────────────────────────────────

async function loginToGoogle(page) {
  log("Navigating to Google sign-in…");
  await page.goto(cfg.GOOGLE_LOGIN_URL, { waitUntil: "domcontentloaded" });

  // Email step
  const emailInput = await find(page, 'input[type="email"]');
  if (!emailInput)
    throw new Error("Could not find email input on Google login page.");
  await typeHuman(page.locator('input[type="email"]'), cfg.GOOGLE_EMAIL);
  await page
    .locator('#identifierNext, button:has-text("Next")')
    .first()
    .click();
  await page.waitForTimeout(2_000);

  // Password step
  const passInput = await find(page, 'input[type="password"]', 15_000);
  if (!passInput)
    throw new Error(
      "Could not find password input – check if Google is asking for verification.",
    );
  await typeHuman(
    page.locator('input[type="password"]:visible'),
    cfg.GOOGLE_PASSWORD,
  );
  await page.locator('#passwordNext, button:has-text("Next")').first().click();
  await page.waitForTimeout(3_000);

  // Handle "Stay signed in?" / "Allow" prompts if they appear
  const staySignedIn = await find(
    page,
    'button:has-text("Yes"), button:has-text("Allow")',
    6_000,
  );
  if (staySignedIn) await staySignedIn.click();

  // Verify we are now signed in
  const finalUrl = page.url();
  if (
    finalUrl.includes("accounts.google.com") ||
    finalUrl.includes("/challenge")
  ) {
    throw new Error(
      "Login did not complete — Google may require 2-factor authentication or CAPTCHA. " +
        "Run once with PLAYWRIGHT_HEADLESS=false to complete the flow manually, then the session will be saved.",
    );
  }

  log("Google login successful.");
}

// ── Step 2: Navigate to GMB Reviews ──────────────────────────────────────────

async function navigateToReviews(page) {
  log("Opening Google Business Profile Manager…");
  await page.goto(cfg.GMB_DASHBOARD_URL, {
    waitUntil: "networkidle",
    timeout: cfg.NAVIGATION_TIMEOUT,
  });

  // If redirected to location selector, pick the right business
  if (page.url().includes("/businesses") || page.url().includes("/select")) {
    log("Multiple locations detected – selecting business…");
    await selectBusiness(page);
  }

  // Wait for the reviews list to appear
  const reviewsLoaded = await find(
    page,
    '[data-review-id], .review-list, [jsname="K3fhe"]',
    20_000,
  );
  if (!reviewsLoaded) {
    // Try clicking the Reviews tab explicitly
    const reviewsTab = await find(
      page,
      'a[href*="reviews"], button:has-text("Reviews")',
      10_000,
    );
    if (reviewsTab) {
      await reviewsTab.click();
      await page.waitForTimeout(3_000);
    }
  }

  log("Reviews page loaded.");
}

async function selectBusiness(page) {
  if (!cfg.GMB_BUSINESS_NAME) {
    // Just click the first available location
    const firstLocation = await find(
      page,
      '.business-card, [data-business-id], li[role="option"]',
      10_000,
    );
    if (firstLocation) await firstLocation.click();
    return;
  }
  // Find by name
  const match = await find(page, `text="${cfg.GMB_BUSINESS_NAME}"`, 10_000);
  if (match) {
    await match.click();
  } else {
    warn(
      `Business "${cfg.GMB_BUSINESS_NAME}" not found in the list. Picking the first one.`,
    );
    const first = await find(page, '.business-card, li[role="option"]', 5_000);
    if (first) await first.click();
  }
}

// ── Step 3: Collect unanswered reviews ───────────────────────────────────────

/**
 * Scrape all visible reviews that have no existing reply.
 * Returns an array of { element, reviewText, reviewerName, rating }.
 */
async function collectUnansweredReviews(page) {
  log("Scanning for unanswered reviews…");

  // Scroll to bottom to load all reviews (GMB uses virtual scrolling)
  await autoScroll(page);

  // Grab all review containers
  // GMB renders reviews inside elements with a reply button when unanswered.
  // These selectors are heuristic – update if Google changes the DOM.
  const reviewCards = await page.$$(
    [
      "[data-review-id]",
      ".review-entry",
      '[jsname="K3fhe"]',
      ".section-review",
    ].join(", "),
  );

  log(`Found ${reviewCards.length} total review card(s).`);

  const unanswered = [];

  for (const card of reviewCards) {
    // Check if a reply already exists
    const hasReply = await card.$(
      [
        ".review-reply",
        "[data-reply-text]",
        'button:has-text("Edit reply")',
        ".owner-response",
      ].join(", "),
    );

    if (hasReply) continue; // already replied

    // Check if there is a "Reply" button (meaning it IS unanswered)
    const replyBtn = await card.$(
      [
        'button:has-text("Reply")',
        "button[data-reply-button]",
        '[jsaction*="reply"]',
      ].join(", "),
    );

    if (!replyBtn) continue;

    // Extract review text
    const reviewText = await card
      .$eval(
        [
          ".review-text",
          "[data-review-text]",
          ".section-review-text",
          "span.wiI7pd",
        ].join(", "),
        (el) => el.innerText.trim(),
      )
      .catch(() => "");

    // Extract reviewer name
    const reviewerName = await card
      .$eval(
        [
          ".reviewer-name",
          ".section-review-title",
          "span.d4r55",
          '[class*="reviewer"]',
        ].join(", "),
        (el) => el.innerText.trim(),
      )
      .catch(() => "Valued Customer");

    // Extract star rating (1-5)
    const ratingEl = await card.$(
      '[aria-label*="star"], [class*="rating"], span.kvMYJc',
    );
    let rating = 5;
    if (ratingEl) {
      const ariaLabel = (await ratingEl.getAttribute("aria-label")) || "";
      const match = ariaLabel.match(/(\d)/);
      if (match) rating = parseInt(match[1], 10);
    }

    unanswered.push({ card, replyBtn, reviewText, reviewerName, rating });
  }

  log(`Found ${unanswered.length} unanswered review(s).`);
  return unanswered;
}

/** Scroll to the bottom of the page incrementally to trigger lazy-loads. */
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 150);
    });
  });
  await page.waitForTimeout(1_000);
}

// ── Step 4: Post replies ──────────────────────────────────────────────────────

/**
 * @param {object}   review       - from collectUnansweredReviews()
 * @param {string}   replyText    - LLM-generated reply
 * @param {object}   page         - Playwright page
 */
async function postReply(page, review, replyText) {
  const { card, replyBtn, reviewerName } = review;

  log(`Posting reply to ${reviewerName}…`);

  // Click the Reply button to open the textarea
  await replyBtn.scrollIntoViewIfNeeded();
  await replyBtn.click();
  await page.waitForTimeout(1_500);

  // Find the reply textarea that appeared
  const textarea = await find(
    page,
    [
      'textarea[placeholder*="reply" i]',
      'textarea[aria-label*="reply" i]',
      ".reply-input textarea",
      '[contenteditable="true"][data-reply-input]',
      'div[contenteditable="true"]',
    ].join(", "),
    10_000,
  );

  if (!textarea) {
    warn(`Could not find reply textarea for ${reviewerName}. Skipping.`);
    return false;
  }

  // Type the reply
  const loc = page
    .locator(
      [
        'textarea[placeholder*="reply" i]',
        'textarea[aria-label*="reply" i]',
        ".reply-input textarea",
        '[contenteditable="true"][data-reply-input]',
        'div[contenteditable="true"]',
      ].join(", "),
    )
    .first();

  await loc.click();
  await loc.fill("");
  await loc.pressSequentially(replyText, { delay: 30 + Math.random() * 40 });
  await page.waitForTimeout(800);

  if (cfg.DRY_RUN) {
    log(
      `[DRY RUN] Would submit reply for ${reviewerName}: "${replyText.slice(0, 60)}…"`,
    );
    // Close without submitting
    const cancelBtn = await find(
      page,
      'button:has-text("Cancel"), button[aria-label="Cancel"]',
      5_000,
    );
    if (cancelBtn) await cancelBtn.click();
    return true;
  }

  // Click the Submit / Post button
  const submitBtn = await find(
    page,
    [
      'button:has-text("Post")',
      'button:has-text("Reply")',
      'button:has-text("Submit")',
      "button[data-reply-submit]",
      '[jsaction*="submit"]',
    ].join(", "),
    8_000,
  );

  if (!submitBtn) {
    warn(`Could not find Submit button for ${reviewerName}. Skipping.`);
    return false;
  }

  await submitBtn.click();
  await page.waitForTimeout(cfg.REPLY_DELAY);

  log(`✔ Reply posted for ${reviewerName}.`);
  return true;
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

/**
 * Run the full automation pipeline.
 *
 * @param {object}   options
 * @param {Function} options.generateReply  - async (reviewText, reviewerName, rating) => string
 * @returns {Promise<{ processed: number, skipped: number, errors: number }>}
 */
async function runGMBAutomation({ generateReply }) {
  if (!cfg.GOOGLE_EMAIL || !cfg.GOOGLE_PASSWORD) {
    throw new Error(
      "GOOGLE_EMAIL and GOOGLE_PASSWORD must be set in your .env file.",
    );
  }

  const savedSession = loadSession();

  const browser = await chromium.launch({
    headless: cfg.HEADLESS,
    slowMo: cfg.SLOW_MO,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });

  const context = await browser.newContext({
    storageState: savedSession || undefined,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: "Asia/Kolkata",
  });

  context.setDefaultTimeout(cfg.ACTION_TIMEOUT);
  context.setDefaultNavigationTimeout(cfg.NAVIGATION_TIMEOUT);

  const page = await context.newPage();

  const stats = { processed: 0, skipped: 0, errors: 0 };

  try {
    // ── Login (skip if session exists) ───────────────────────────────────────
    if (!savedSession) {
      await loginToGoogle(page);
      await saveSession(context);
    } else {
      log("Using saved session – skipping login.");
      // Validate the session is still alive
      await page.goto("https://accounts.google.com", {
        waitUntil: "domcontentloaded",
      });
      if (
        page.url().includes("/signin") ||
        page.url().includes("/ServiceLogin")
      ) {
        warn("Saved session expired. Re-logging in…");
        clearSession();
        await loginToGoogle(page);
        await saveSession(context);
      }
    }

    // ── Navigate to reviews ──────────────────────────────────────────────────
    await navigateToReviews(page);

    // ── Collect unanswered reviews ───────────────────────────────────────────
    const reviews = await collectUnansweredReviews(page);

    if (reviews.length === 0) {
      log("No unanswered reviews found. All done!");
      return stats;
    }

    // ── Generate & post replies ──────────────────────────────────────────────
    for (const review of reviews) {
      try {
        log(
          `Generating reply for "${review.reviewerName}" (${review.rating}★)…`,
        );
        const replyText = await generateReply(
          review.reviewText,
          review.reviewerName,
          review.rating,
        );

        if (!replyText || replyText.trim().length === 0) {
          warn(
            `LLM returned empty reply for ${review.reviewerName}. Skipping.`,
          );
          stats.skipped++;
          continue;
        }

        const posted = await postReply(page, review, replyText.trim());
        if (posted) stats.processed++;
        else stats.skipped++;
      } catch (e) {
        err(`Error processing review by ${review.reviewerName}: ${e.message}`);
        stats.errors++;
      }
    }
  } catch (e) {
    err(`Fatal error: ${e.message}`);
    throw e;
  } finally {
    await browser.close();
    log(
      `Done. Processed: ${stats.processed} | Skipped: ${stats.skipped} | Errors: ${stats.errors}`,
    );
  }

  return stats;
}

// ── Standalone entry point ────────────────────────────────────────────────────

if (require.main === module) {
  // When run directly, pull in a simple LLM helper from utils/
  // Adjust the path to match your actual LLM utility file.
  let generateReply;
  try {
    const llm = require("../utils/llmHelper"); // adjust as needed
    generateReply = llm.generateReply || llm.default;
  } catch {
    // Fallback: echo-style reply for quick smoke-testing
    warn("Could not load utils/llmHelper – using placeholder replies.");
    generateReply = async (text, name, rating) =>
      `Thank you for your ${rating}-star review, ${name}! We appreciate your feedback.`;
  }

  runGMBAutomation({ generateReply })
    .then((stats) => {
      console.log("Automation complete:", stats);
      process.exit(0);
    })
    .catch((e) => {
      console.error("Automation failed:", e);
      process.exit(1);
    });
}

module.exports = { runGMBAutomation };
