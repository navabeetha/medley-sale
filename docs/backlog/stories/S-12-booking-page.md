# S-12: Booking page

| | |
|---|---|
| **Points** | 2 |
| **Slice** | 2: Reserve |
| **Depends on** | S-10, S-11 |
| **Status** | Backlog |
| **Pod type** | feature |
| **Gate** | none |
| **Branch** | `S-12-booking-page` |

## Acceptance criteria (brief Section 8, verbatim)

- Groups as Reserved, Waiting (with position), Sold to you and Ended. Multi-unit items are grouped, for example "Picture frame × 2".
- Shows the skipped items, and the "saved" line from Section 6.4.
- Unknown tokens get a plain not-found message.
- Saved to the device, with a **My reservations** link in the header when anything is saved.

## References

- API 4.3 (`POST {action:"booking", token}`, with the token in the body only). Route `#/b/<token>` 4.4 (no-referrer). D-005 (`localStorage`), D-009. Rule 6.1.8 (sold-out waiters see "This item was sold").
- Copy 6.4: "Your reservation is saved, even if you don't send the message."
- Critical scenarios: **T-11** (random token), **T-14** (storage blocked: booking link still shown).

## the seller needs to do

Nothing.

## Out of scope

The WhatsApp jump (S-13) and back-out (S-14).
