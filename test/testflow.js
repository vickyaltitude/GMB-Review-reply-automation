async function main() {
  const testReviews = [
    {
      reviewId: "rev_001",
      reviewerName: "Angry Customer",
      starRating: 1,
      reviewText:
        "The food gave me food poisoning. I was hospitalised for two days. This is completely unacceptable and I will be filing a complaint.",
      businessName: "Sri Biryani Palace",
    },
    {
      reviewId: "rev_002",
      reviewerName: "Random User",
      starRating: 1,
      reviewText: "Wrong place. I was looking for a different restaurant.",
      businessName: "Sri Biryani Palace",
    },
    {
      reviewId: "rev_003",
      reviewerName: "Regular Visitor",
      starRating: 3,
      reviewText: "Food was okay but service was a bit slow during lunch hour.",
      businessName: "Sri Biryani Palace",
    },
    {
      reviewId: "rev_004",
      reviewerName: "Happy Foodie",
      starRating: 5,
      reviewText:
        "Absolutely the best biryani in Puducherry! The staff were incredibly warm and the food arrived hot and fresh. Will definitely return!",
      businessName: "Sri Biryani Palace",
    },
  ];

  for (const review of testReviews) {
    await routeReview(review);
    console.log("─".repeat(50));
    await new Promise((r) => setTimeout(r, 2000)); // 2s gap to avoid rate limits
  }
}

main();
