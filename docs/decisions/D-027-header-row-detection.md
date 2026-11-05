# D-027: Item tabs' header row is found, not assumed to be row 1

- **Status:** Proposed (PM, 2026-11-05). Smaller option taken; doesn't change a Section 5 decision. It extends 4.1 ("find columns by header name, never by position") to rows.
- **Context:** first live `scrubStaging` run on the build copy (G0.3 part 1, 2026-11-05) logged `WARNING no Person column found` for Tech, Gym & Sport, Home Things, Books and Template, and replaced 0 people. The seller confirmed the headers are on **row 2** in Tech and Books, with the column named `Person`. Row 1 holds something else, such as a title. Every S-03 path read `grid[0]` as the header.

## Rule

1. **Header row:** for any tab other than README and the system tabs (Claims, Bookings, To do, Sold), the header row is the **first row among the top 5** that has a cell reading exactly `Person` once trimmed. That covers item tabs and Template.
2. **No such row:** the tab is treated exactly as today's "no Person column" case. The scrub scans every cell for numbers and logs the WARNING, and migrate's preflight refuses with its existing "has no Person column" error.
3. **Rows above the header** (titles, notes) are never data rows. They aren't validated as items, aren't given IDs or quantities and never become claims. The scrub **scans them in full** for the seller's number (with any formulas and links), the same way it treats the header row.
4. **Data rows** are the rows below the header row. All row numbers written back (IDs, quantities, Person, claims' source rows) are the real sheet rows.
5. **New columns** `ID` and `Quantity` are written into the detected header row.
6. **System tabs** that S-03 creates (Claims, Bookings, To do, Sold) keep their header in row 1, unchanged.
7. The lookup lives in one shared helper, so S-04, S-11 and S-15 read item tabs the same way.

## Cost

If the seller later adds a row with the word `Person` in it above the real header, within the top 5 rows, that row would be taken as the header. That's unlikely, and preflight would refuse loudly because the Status and item columns would be missing.
