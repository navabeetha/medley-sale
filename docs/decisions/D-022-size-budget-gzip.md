# D-022: The 50 KB budget is measured with gzip

- **Status:** Proposed (S-01 confirms when it builds the check)
- **Date:** 2026-11-03
- **Raised by:** PM, docs setup
- **Context:** Brief 2.4 and 8.1 set "HTML, CSS and JS 50 KB compressed in total", without naming the compression.
- **Decision:** The CI budget check measures gzip, at maximum level, of the built HTML, CSS and JS files summed together, excluding photos and API data.
- **Why:** GitHub Pages serves gzip. Brotli gives smaller numbers, so measuring gzip is the stricter, safer reading.
- **Revisit if:** Pages starts serving Brotli and the budget gets tight.
