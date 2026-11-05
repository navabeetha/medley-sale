# D-030: Catalogue response shape and sources

- **Status:** Proposed (PM, 2026-11-05). Smaller option taken in each case. None changes a Section 5 decision.
- **Context:** the S-04 red step (test/unit/catalogue.test.ts) had to pin details that brief 4.3 leaves open.

## Rules

1. **Fields:** each item has exactly `id, tab, name, brand, author, category, price, availableFrom, notes, link, quantity, unitsLeft, freeUnits, waitingCount, photos`. There is never a status, a person or anything else from Claims or Bookings (T-12).
2. **`freeUnits`** is added on top of the brief's list. It comes from the queue engine, so the site can tell "Reserved" (no free unit, people can join the waiting list) from "3 left" (6.2).
3. **Photo count** is injected into the handler (`opts.photoCounts`, keyed by item ID, default 0). Sheet images are floating and can't be read through the sheet interface. The source is the S-05 manifest (`public/photos/manifest.json`). Until the adapter is wired to it, the count is 0 and the site may count from the manifest directly (S-06 decides).
4. **Sold out** is decided by Claims and Quantity through the engine, never by the Status text. Quantity 0 and invalid quantities are hidden (D-026).
5. **Links** come from the rich-text link on the brand cell, or on Books the book-name cell. Only http(s) links are kept; any other link becomes null, because links become hrefs.
6. **Dates (amended after S-04 QA F1):** `availableFrom` is a plain calendar date `YYYY-MM-DD` in the **spreadsheet's time zone**. Apps Script returns date cells as midnight in that zone (Asia/Kolkata), so `toISOString()` would show the day before. The pure handler takes an injected `formatDate`; the adapter passes `Utilities.formatDate(d, tz, "yyyy-MM-dd")`. Text such as "Now" passes through, and blank becomes null.
8. **Errors are JSON (S-04 QA F3):** request handling is a pure `handleGet` in `src/api/`. Any failure returns a generic `{"error":"unavailable"}` that never echoes the exception text (it could contain cell content), and nothing is cached. An unknown action returns `{"error":"unknown action"}`.
9. **Item tabs are an allow-list (S-04 QA F4):** only Tech, Gym & Sport, Home Things and Books are published. Any other tab, hidden or copied, is never published. A new category tab needs a code change, which is deliberate.
10. **Price** is a number or null. Text in a price cell becomes null.
7. **Cache:** the handler is pure. The short server cache lives in the Apps Script adapter (CacheService) and is cleared by every write handler (S-11, S-14, S-15). It's tested there, or as a live check.
