"use strict";

const fs = require("fs");
const path = require("path");

const SESSION_FILE = path.resolve(__dirname, "../.gmb_session.json");

/**
 * Save the current browser context's cookies & storage to disk.
 * Call this after a successful login so future runs skip the login flow.
 */
async function saveSession(context) {
  const storage = await context.storageState();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(storage, null, 2));
  console.log("[SessionManager] Session saved to", SESSION_FILE);
}

/**
 * Returns the stored storageState object if it exists, or null.
 * Pass the return value to `browser.newContext({ storageState })`.
 */
function loadSession() {
  if (fs.existsSync(SESSION_FILE)) {
    console.log("[SessionManager] Loading existing session from", SESSION_FILE);
    return JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
  }
  return null;
}

/**
 * Delete the saved session (e.g. when it has expired and login fails).
 */
function clearSession() {
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
    console.log("[SessionManager] Session cleared.");
  }
}

module.exports = { saveSession, loadSession, clearSession };
