const { sendEmail, postToTeamsChannel, logToSheet } = require("./helper");
const { callWithFallback } = require("./server");

// ✅ Bug 3 fixed — define as local functions first, then export
const generateCelebrationMessage = async function (reviewData, analysis) {
  const prompt = `Write a short, enthusiastic internal team message (2-3 sentences max) 
celebrating this 5-star review. Make it feel genuine and recognise the team's effort.
Reviewer: ${reviewData.reviewerName}
Review: "${reviewData.reviewText}"
Keep it under 50 words. Use 1-2 emojis.`;

  return await callWithFallback([{ role: "user", content: prompt }]);
};

const handleStandard = async function (reviewData, analysis) {
  console.log("✅ STANDARD: Draft generated, routing to standard approver");

  const emailBody = `
New Review — Approval Needed

Business: ${reviewData.businessName}
Reviewer: ${reviewData.reviewerName}
Rating: ${reviewData.starRating}★
Review: "${reviewData.reviewText}"

Suggested Reply:
"${analysis.draft_reply}"

──────────────────────────
✅ Approve: ${process.env.APPROVAL_WEBHOOK}?action=approve&id=${reviewData.reviewId}
❌ Reject: ${process.env.APPROVAL_WEBHOOK}?action=reject&id=${reviewData.reviewId}
  `;

  await sendEmail({
    to: process.env.APPROVER_EMAIL,
    subject: `New Review — ${reviewData.starRating}★ from ${reviewData.reviewerName}`,
    body: emailBody,
  });
};

module.exports.handleHold = async function (reviewData, analysis) {
  console.log("🚨 HOLD: Alerting senior leadership, no draft generated");

  const alertMessage = `
🚨 URGENT REVIEW ALERT — Action Required

Business: ${reviewData.businessName}
Reviewer: ${reviewData.reviewerName}
Rating: ${reviewData.starRating}★
Review: "${reviewData.reviewText}"

Claude's Assessment: ${analysis.summary}

⚠️ No auto-reply has been drafted.
Please review this personally and reply to this email
with context before a draft is generated.

Reply to: ${process.env.OWNER_EMAIL}
  `;

  await sendEmail({
    to: process.env.SENIOR_EMAIL,
    subject: `🚨 Urgent Review Alert — ${reviewData.businessName}`,
    body: alertMessage,
  });
};

module.exports.handleSenior = async function (reviewData, analysis) {
  console.log("⚠️ SENIOR: Draft generated, routing to senior leadership");

  const emailBody = `
New Review Requires Your Approval

Business: ${reviewData.businessName}
Reviewer: ${reviewData.reviewerName}
Rating: ${reviewData.starRating}★
Review: "${reviewData.reviewText}"

Claude's Draft Reply:
"${analysis.draft_reply}"

Claude's Note: ${analysis.summary}

──────────────────────────
✅ Approve: ${process.env.APPROVAL_WEBHOOK}?action=approve&id=${reviewData.reviewId}
✏️  Edit & Approve: Reply to this email with your revised reply
❌ Reject: ${process.env.APPROVAL_WEBHOOK}?action=reject&id=${reviewData.reviewId}
  `;

  await sendEmail({
    to: process.env.SENIOR_EMAIL,
    subject: `⚠️ Review Approval Needed (Senior) — ${reviewData.businessName}`,
    body: emailBody,
  });
};

module.exports.handleStandard = handleStandard;

module.exports.handleCelebrate = async function (reviewData, analysis) {
  console.log("🎉 CELEBRATE: Draft generated + sending team celebration");

  await handleStandard(reviewData, analysis); // ✅ local ref works

  const celebrationMessage = await generateCelebrationMessage(
    reviewData,
    analysis,
  ); // ✅
  await postToTeamsChannel(celebrationMessage);
};

module.exports.generateCelebrationMessage = generateCelebrationMessage;
