// Public site configuration. Safe to commit: this is the Apps Script web-app URL, which is
// public by design (brief 4.2). It must stay on script.google.com (the CSP connect-src allows
// only that host and script.googleusercontent.com) and must carry no query string.
// R1 (2026-11-06): the REAL sheet's "R1 catalogue" deployment (browse-only, D-035/D-036).
// The staging deployment on the build copy still exists for development.
export const API_URL =
  "https://script.google.com/macros/s/AKfycbwfzxV7jtMq-zQTTN5y4zCdk3tRRijZzkuJf78fahD-ZRkLmdzNZWv2E2jNcZzkPch9/exec";
