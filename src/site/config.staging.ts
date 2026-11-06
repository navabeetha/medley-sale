// Staging configuration (G1): the build copy's staging web-app deployment. tools/build.mjs swaps this file in for
// ./config when it builds the second copy of the site into dist/staging/, which Pages serves at /medley-sale/staging/.
// Public by design, like config.ts: script.google.com only, no query string.
export const API_URL =
  "https://script.google.com/macros/s/AKfycbyJCnZHTDkSBjEYCfeFxLVt7BuQ5_-CfLppeVJal8tGIsgou15y0G4zdglognBcS5dh/exec";
