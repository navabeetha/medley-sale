# S-03: Sheet schema and migration

| | |
|---|---|
| **Points** | 3 |
| **Slice** | 1: See the sale |
| **Depends on** | S-01 |
| **Status** | Backlog |
| **Pod type** | feature |
| **Gate** | **G0.2** before anything runs on the build copy. **G0.3** (The seller's scrub check) before anything except `scrubStaging()` touches it ([D-018](../../decisions/D-018-g0-in-stages.md)) |
| **Branch** | `S-03-sheet-schema-migration` |

## Acceptance criteria (brief Section 8, verbatim)

A rerunnable script that prepares a sheet. A separate one-off `scrubStaging()` runs first on the build copy only, before any other agent work reads it.
- `scrubStaging()` replaces every `Person` value with synthetic names, removes the seller's number from the README and all tab headers, and removes any comments it can. It refuses to run unless the file's title contains `BUILD COPY`. The seller confirms the result by eye.
- Adds columns and new tabs from Section 4.1, data validation on `State`, and the `To do` and `Sold` formulas.
- Assigns stable IDs and sets blank quantities to 1, including in the Template tab.
- Creates a booking and claim, with a token, for each row with a `Person`. `Reserved` becomes `active` and `Sold` becomes `sold` at the listed price.
- Running twice changes nothing and prints counts for review.
- A blank or unknown status stops with a clear error.
- Tested on the staging copy with synthetic names only.

## References

- Sheet structure 4.1 (columns found by header name, never position. Books mapping). Secrets and staging 4.2. Audit 3 (no comment parsing, quantity 1 for existing rows).
- 1.3.2 (no agent reads the build copy before the scrub is checked). Hard rule 11.6.4.
- D-003, D-004, D-005 (token of at least 128 bits). Spreadsheet safety 6.3. Only one agent changes the sheet schema at a time.
- Critical scenarios: **T-17**.

## Notes

- Code and fixture tests (T-17) can be written before G0. Running on the build copy can't.
- 7 criteria: at the limit, but one area. If it grows, split `scrubStaging()` into its own story.

## the seller needs to do

G0.2 (build copy titled `BUILD COPY`, attach a script, enable the Apps Script API, `clasp login`), then G0.3 (check the scrub by eye and say "scrub checked").

## Out of scope

Running anything on the real sheet (that's S-18 at G2), the API, and triggers.
