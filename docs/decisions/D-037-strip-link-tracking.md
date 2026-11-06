# D-037: Strip ad and click tracking from public item links

- **Status:** Accepted (the seller, 2026-11-06), after the R1 live T-12 scan.
- **Why:** links on the real sheet were copied from shopping sites and carry ad-tracking parameters. Amazon's include `hvlocphy`, a rough location code for where the ad was clicked. It's the seller's own data, not a neighbour's, so it didn't block R1, but she asked for it to be removed. T-12 also flagged these links (bare-ID rule) as noise.

## Decisions

1. **Amazon links lose their whole query string.** Host `amazon.<tld>` (two or three letters, optionally after `com.` or `co.`, e.g. `amazon.com.au`, `amazon.co.uk`) or a subdomain of it. A look-alike such as `amazon.in.evil.example` isn't treated as Amazon (QA F1). The product is identified in the path (`/dp/<ASIN>`), so nothing functional lives in the query. The path, including any `/ref=…` segment, is kept.
2. **Other links lose only known tracker parameters**, matched by name, case-insensitively: `utm_*`, `gclid`, `gbraid`, `wbraid`, `dclid`, `gad_*`, `fbclid`, `msclkid`, `mc_cid`, `mc_eid`, `igshid`, `_ga`, `_gl`, `yclid`, `ttclid`. Everything else is kept in order (e.g. `region_id`, `pid`), so a link never stops working.
3. **The fragment (`#…`) is kept.** If no parameters remain, the `?` goes too.
4. **Done in the API (`safeLink` in `src/api/catalogue.ts`)**, not the site, so the tracking never leaves the script. Plain string parsing, because Apps Script has no `URL` class. The sheet itself is never changed.
