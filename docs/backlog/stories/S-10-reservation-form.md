# S-10: Reservation form

| | |
|---|---|
| **Points** | 2 |
| **Slice** | 2: Reserve |
| **Depends on** | S-09 |
| **Status** | Backlog |
| **Pod type** | feature |
| **Gate** | none |
| **Branch** | `S-10-reservation-form` |

## Acceptance criteria (brief Section 8, verbatim)

- Lists selected items with a remove action and the likely outcome: reserve, or waiting list position.
- Validation as in Section 6.3, with errors beside fields and input kept.
- Name and number are remembered on the device, with a clear option. Uses `type="tel"` and correct `autocomplete`.
- Includes the notice from Section 6.4.

## References

- Validation 6.3 (name 2 to 60 characters trimmed. Number: 10 digits means +91, otherwise `+` and a valid international length, stored as E.164. Idempotency key generated when the form opens. Honeypot). Phone logic lives in `src/domain/`.
- Copy 6.4: "Your number is only seen by the seller and is used only for this sale." D-014 (name and number only). UX 7 errors (a failed form keeps what was typed). Route `#/reserve`.
- Critical scenarios: **T-15** (input kept on API failure, with S-11), **T-10** (inert text in the site).

## Bugfix tickets carried from S-09 QA re-check (PM, 2026-11-06); do these first

- **B1 (S4):** on a short page the sticky basket bar floats mid-screen. In reserving mode make body a full-height column (`min-height: 100dvh`) and push the bar down with `margin-top: auto`. Add a short-list e2e test (2 items, 390x700: the bar's bottom equals the viewport bottom).
- **B2 (S4):** merging hidden (cache-pruned) entries back after the live render can push the basket past 15. Add each hidden entry only while the total stays at or under 15; show the limit message for any that don't fit.
- **B3 (S4):** a cached list with fewer free units makes the stored count shrink permanently once the user changes anything. Keep the buyer's chosen count until a live render lowers it.

## PM decisions on the red step's open points (2026-11-06)

- **Idempotency key lifetime:** keep the key until a booking succeeds, across reloads and leaving/re-opening the form (sessionStorage, wrapped in try/catch; in memory if storage is blocked), so a timed-out booking retried after a reload can't book twice. On `invalid-request`, make a new key.
- **Request timeout:** 30 seconds, then the "try again" message (the tests allow 10 to 130 s).
- **Basket bar** stays hidden on the reserve screen.
- **Remove** removes the whole entry; the outcome is one line per entry.
- **Shared copy** is fine for `invalid-request`, `not-configured` and handler errors; the four the tests pin must stay distinct.
- **Name length** counted like the API (UTF-16), kept for parity.

## Notes from S-11 (PM, 2026-11-06)

- Request fields (pinned by S-11): `{ action: "reserve", name, number, idempotencyKey, items: [{id, quantity}], website }` sent as a `text/plain` JSON POST body. `website` is the honeypot.
- The idempotency key must be at least 128 random bits and match `^[A-Za-z0-9-]{16,64}$` (e.g. `crypto.randomUUID()` in the browser). It is generated when the form opens and kept until a booking succeeds.
- Honeypot field markup: `autocomplete="off"`, a non-standard name, `tabindex="-1"`, `aria-hidden="true"`, visually hidden, so browser autofill never fills it for a real buyer.
- Phone errors: `91` plus ten digits without `+` is refused, so the error copy should say to add `+`. Use `normalisePhone` from `src/domain/phone.ts` on the client too, so the site and API agree.
- Error codes to map to friendly copy: `invalid-name`, `invalid-number`, `invalid-basket`, `invalid-request`, `too-many-claims`, `nothing-available` (with `skipped`), `not-reserving`, `not-configured`, `busy`, plus `{error:"unavailable"}` and network failure (T-15: keep the input).

## the seller needs to do

Nothing.

## Out of scope

The save itself (S-11) and the confirmation page (S-12).
