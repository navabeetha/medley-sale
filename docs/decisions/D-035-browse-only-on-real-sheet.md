# D-035: The browse-only release reads the real sheet (early, partial G2)

- **Status:** Accepted (the seller, 2026-11-05). Deliberately overrides brief 4.2 ("nothing about [the real sheet] changes during the build") and rule 4 ("don't read or edit the real sheet before G2"), at the seller's request, for the browse-only release (D-034).
- **Why:** the seller keeps statuses current in the real sheet. A site reading the practice copy would go stale unless she mirrored every change by hand.

## What changes on the real sheet (and nothing else)

1. **Backup first:** the seller makes a copy of the sheet (File > Make a copy) before anything else.
2. **The same script bundle is attached.** `scrubStaging` and `migrateSheet` keep refusing, because the title has no `BUILD COPY` (QA B1 guard). No Claims, Bookings, To do or Sold tabs are created.
3. **A new editor function, `addIdColumns`, does the setup:**
   - It adds `ID` and `Quantity` headers at the far right of each item tab's header row (D-027).
   - It fills IDs in tab, then row, order using the same `I-NNNN` scheme as `migrate`, so they match the build copy's IDs and the published photos. Blank quantities get 1.
   - It's idempotent, and it never reads or writes `Person`.
   - The PM verifies the match by comparing item names per ID between the staging and real catalogues before the link is shared.
4. **Script Property `SELLER_WHATSAPP`** is set by the seller. The catalogue returns `contactUrl` = `https://wa.me/<digits>`.
5. **Warm job:** a time-driven trigger (every 5 minutes) on `warmCatalogue`, installed by the seller in the Triggers screen (D-034).
6. **Web-app deployment:** "Execute as Me", "Anyone". Its URL becomes the site's public API URL (4.2).

## How availability works without Claims (status mode)

When the spreadsheet has **no `Claims` tab**, the catalogue reads availability from the item row's `Status`:

| Status | Shown as |
|---|---|
| `Available` | `unitsLeft = freeUnits = Quantity` |
| `Reserved` | `unitsLeft = Quantity`, `freeUnits = 0` ("Reserved") |
| `Sold` | excluded |
| anything else | excluded (fail closed) |

`waitingCount` is 0. When a `Claims` tab exists (build copy, and after the full G2), the queue engine is used as before (D-030).

## Unchanged

- The site never shows `Person`, comments or Notes beyond the item text (T-12).
- **Public sharing of the sheet stays as it is today.** Turning it off belongs to the full G2, with online reserving.
- The brief's text fixes ("Bandminton", "camr", "stil", "renovable", "Phillips") are offered to the seller to correct by hand. The tool doesn't apply them.
