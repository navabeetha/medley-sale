// Public site configuration. Safe to commit: this is the Apps Script web-app URL, which is
// public by design (brief 4.2). It must stay on script.google.com (the CSP connect-src allows
// only that host and script.googleusercontent.com) and must carry no query string.
// This is the STAGING deployment; swap it for the real one at cutover (G2).
export const API_URL =
  "https://script.google.com/macros/s/AKfycbyJCnZHTDkSBjEYCfeFxLVt7BuQ5_-CfLppeVJal8tGIsgou15y0G4zdglognBcS5dh/exec";
