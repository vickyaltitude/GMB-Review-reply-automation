const {
  handleHold,
  handleSenior,
  handleStandard,
  handleCelebrate,
} = require("./handler");
const { sendEmail, postToTeamsChannel, logToSheet } = require("./helper");
const { analyseReview } = require("./server");

module.exports.routeReview = async function (reviewData) {
  const { reviewText, starRating, reviewerName, businessName } = reviewData;

  console.log(`\nProcessing review from ${reviewerName} (${starRating}★)`);

  // Get Claude's analysis
  const analysis = await analyseReview(reviewText, starRating, businessName);
  console.log("Analysis:", analysis);

  // Route to correct handler based on Claude's decision
  switch (analysis.route) {
    case "hold":
      await handleHold(reviewData, analysis);
      break;

    case "senior":
      await handleSenior(reviewData, analysis);
      break;

    case "standard":
      await handleStandard(reviewData, analysis);
      break;

    case "celebrate":
      await handleCelebrate(reviewData, analysis);
      break;

    default:
      console.error("Unknown route:", analysis.route);
  }

  // Always log to database/sheet regardless of route
  await logToSheet(reviewData, analysis);
};
