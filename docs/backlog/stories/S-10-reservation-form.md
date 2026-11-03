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

## the seller needs to do

Nothing.

## Out of scope

The save itself (S-11) and the confirmation page (S-12).
