// Travel Companion public configuration.
// This file is safe to commit to GitHub Pages.
// IMPORTANT: Never put OPENAI_API_KEY or any other secret in this file.
window.TRAVEL_COMPANION_CONFIG = {
  // After deploying the Cloudflare Worker, paste its base URL here.
  // Example: "https://travel-companion-ai.your-account.workers.dev"
  API_BASE_URL: "https://travel-companion-ai.skyjessia01.workers.dev",
  // Optional shared beta code. Leave blank unless BETA_ACCESS_CODE is set on the Worker.
  // If the Worker requires a beta code, users will be prompted once and it is kept in this browser.
  BETA_ACCESS_CODE_HINT: ""
};
