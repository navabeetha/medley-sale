# D-036: Browse-only release hardening after QA (status text, WhatsApp number, setup checks)

- **Status:** Accepted (PM, 2026-11-05), from the R1 QA entry in `docs/qa/qa-log.md`. Refines D-034 and D-035 and does not reverse them.
- **Why:** the real sheet is typed by hand. A stray space, or a number entered without its country code, would hide items or send buyers' messages to the wrong person, and nothing would tell the seller.

## Decisions

1. **Status matching ignores case and surrounding spaces.** `Available`, `available` and `Available ` all count as Available, and the same goes for Reserved. Anything else, including Sold and blank, stays hidden, as D-035 says.
2. **`SELLER_WHATSAPP` must include the country code.** Spaces, `+`, `-` and brackets are stripped. The remaining digits are accepted only if they are 11 to 15 digits long, don't start with 0, and nothing else was in the value. A leading `00` (international dialling prefix) is dropped first. A number starting `91` (India) must be exactly 12 digits, with the digit after 91 from 6 to 9; this rejects `+91 0…` with a stray trunk 0. Anything else gives `contactUrl: null`, so the site shows no reserve link rather than a wrong one. The runbook says "with country code, e.g. 91 then your 10 digits".
3. **`addIdColumns` checks all four tabs before it writes anything** (so a run never half-numbers the sheet), and tests pin this.
4. **Items added after setup need `addIdColumns` run again.** This is a runbook note; a second run fills only rows that have no ID.
5. **Engine-mode tests keep a Claims tab** (an empty one where needed), so they don't silently pass in status mode.
6. **A test pins the Apps Script bundle's top-level functions and its OAuth scope** (`spreadsheets.currentonly` only).

## Wording fix to D-035

`addIdColumns` *reads* `Person` only to tell whether a row is blank, as `migrate` does. It never writes or outputs it.

## Not changed

- An unusable Quantity (blank, text, 0, negative or a fraction) still hides the row in both modes (D-026). `addIdColumns` fills blanks with 1 at setup.
- ID matching between the build copy and the real sheet stays a PM live check: the name for every ID is compared before the link is shared (D-035).
