# D-030: Catalogue response shape and sources

- **Status:** Proposed (PM, 2026-11-05). Smaller option taken in each case. None changes a Section 5 decision.
- **Context:** the S-04 red step (test/unit/catalogue.test.ts) had to pin details that brief 4.3 leaves open.

## Rules

1. **Fields:** each item has exactly `id, tab, name, brand, author, category, price, availableFrom, notes, link, quantity, unitsLeft, freeUnits, waitingCount, photos`. There is never a status, a person or anything else from Claims or Bookings (T-12).
2. **`freeUnits`** is added on top of the brief's list. It comes from the queue engine, so the site can tell "Reserved" (no free unit, people can join the waiting list) from "3 left" (6.2).
3. **Photo count** is injected into the handler (`opts.photoCounts`, keyed by item ID, default 0). Sheet images are floating and can't be read through the sheet interface. The source is the S-05 manifest (`public/photos/manifest.json`). Until the adapter is wired to it, the count is 0 and the site may count from the manifest directly (S-06 decides).
4. **Sold out** is decided by Claims and Quantity through the engine, never by the Status text. Quantity 0 and invalid quantities are hidden (D-026).
5. **Links** come from the rich-text link on the brand cell, or on Books the book-name cell. Only http(s) links are kept; any other link becomes null, because links become hrefs.
6. **Dates:** a date cell becomes an ISO string. Text such as "Now" passes through. Blank becomes null.
7. **Cache:** the handler is pure. The short server cache lives in the Apps Script adapter (CacheService) and is cleared by every write handler (S-11, S-14, S-15). It's tested there, or as a live check.
