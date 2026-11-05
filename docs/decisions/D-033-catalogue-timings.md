# D-033: Catalogue live timings (S-04, per D-020)

- **Status:** Measured (PM, 2026-11-05). The mitigation decision is the seller's (S-04 acceptance criteria).
- **Setup:** staging web app on the build copy (deployment "staging catalogue", version 3), 62 items across the four tabs, measured from a laptop in India with `fetch`. The deployment had first served stale code ("Script function not found: doGet") because an open editor tab had saved an older copy over the 17:49 push. The code was re-pushed and the deployment moved to a new version with `clasp redeploy`.

## Results

| Case | Samples (ms) | Median |
|---|---|---|
| Cold (first call after idle) | 9,599 | ~9.6 s |
| Warm cache miss (35 s apart, cache expired) | 8,001 · 12,807 · 10,314 · 11,884 | 11.9 s |
| Warm cache hit (immediate repeats) | 1,880 · 1,589 · 1,672 · 1,511 · 1,664 · 1,281 · 4,688 · 1,602 · 2,595 · 1,399 · 1,687 · 1,437 | 1.7 s |
| From the Pages origin in a browser | Chromium 12,792 (miss) · WebKit 1,747 (hit) | |

**Warm misses are well over the 3 s limit in S-04's acceptance criteria.** Raised with the seller on 2026-11-05.

## Other live checks (all pass)

- **CORS from `https://navabeetha.github.io`:** works in Chromium and WebKit. **D-001 is a GO.**
- **JSON responses:**
  - The catalogue returns `application/json`.
  - No action, `x`, `Catalogue` and `catalogue%20` each give `{"error":"unknown action"}`.
- **Items:** 62 (Tech 13, Gym & Sport 8, Home Things 1, Books 40). Books give the name from `Brand (+ Link)` plus the author, with brand null. Keys match D-030 exactly.
- **Privacy (T-12, live):** 0 "Test Person" hits and no 10+ digit runs. All 18 notes are item descriptions with no names; the PM read them.
- **Dates:** values are only "Now" and `2026-12-02` (correct day; F1 holds live).
- **Links:** 54 links. 2 are http rather than https (allowed, D-030 rule 5), and none point at Google Docs, Drive or WhatsApp.
- **Queue:** 1 null price, 7 items with `freeUnits` 0 (held), and no waiting lists yet.
