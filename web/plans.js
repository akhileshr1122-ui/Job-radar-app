// Plans shown on the homepage and in the app. Edit names, prices and lists here.
// Limits are enforced by the server (api/jr/index.js PLANS and engine/azure_run.py PLAN_LIMITS): keep them in step.
// paymentLink: paste a Stripe (or other) payment link to let people pay online; empty = they ask you to upgrade them.

export const CURRENCY = "CA$";

export const PLANS = [
  {
    id: "free", name: "Free", price: 0, period: "month",
    blurb: "Everything you need to search properly.",
    features: [
      "Matches from every job source, every 4 hours",
      "10 tailored resumes and cover letters per search",
      "Application tracker and follow-up reminders",
      "AI resumes with your own Claude plan",
      "3 on-demand searches a day",
    ],
    paymentLink: "",
  },
  {
    id: "plus", name: "Plus", price: 9, period: "month",
    blurb: "AI-written resumes included. No Claude account needed.",
    features: [
      "Everything in Free",
      "25 tailored resumes per search",
      "Up to 15 AI-written resumes and cover letters a day",
      "Interview prep sheets",
      "10 on-demand searches a day",
    ],
    paymentLink: "",
    highlight: true,
  },
  {
    id: "pro", name: "Pro", price: 19, period: "month",
    blurb: "For an all-out search.",
    features: [
      "Everything in Plus",
      "40 tailored resumes per search",
      "Up to 40 AI-written resumes a day",
      "30 on-demand searches a day",
    ],
    paymentLink: "",
  },
];

export const planById = (id) => PLANS.find((p) => p.id === id) || PLANS[0];
export const priceText = (p) => `${CURRENCY}${p.price}`;
