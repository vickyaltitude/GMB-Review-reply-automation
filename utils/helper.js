const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD, // Gmail App Password, not your real password
  },
});

module.exports.sendEmail = async function ({ to, subject, body }) {
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject,
    text: body,
  });
  console.log(`Email sent to ${to}`);
};

module.exports.postToTeamsChannel = async function (message) {
  // Microsoft Teams incoming webhook
  const response = await fetch(process.env.TEAMS_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
  console.log("Teams message posted:", response.status);
};

module.exports.logToSheet = async function (reviewData, analysis) {
  // Later: write to Google Sheets or Neon DB
  console.log("Logged:", {
    timestamp: new Date().toISOString(),
    reviewer: reviewData.reviewerName,
    rating: reviewData.starRating,
    route: analysis.route,
    sentiment: analysis.sentiment,
    isSpam: analysis.is_spam,
  });
};
