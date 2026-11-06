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

## Bugfix tickets carried from the S-10 QA (PM, 2026-11-06); do these first, with failing tests

- **F1 (S3):** the live list arriving while the buyer types on `#/reserve` detaches the focused input, which closes the phone keyboard. When the screen is already shown, re-render only the list and don't call `reserve.open()` again.
- **F2 (S3):** on success, remove from the basket only the entries that were sent, and disable Remove while a booking is pending.
- **F4 (S4):** on entering the form, focus its h2 (tabindex -1). On Back, restore the catalogue's scroll position and focus the Reserve link.
- **F3 (release):** a successful booking must land on `#/b/<token>`, which this story adds. Reserving mode must not reach buyers before this story ships.
- **F5:** added to the G1 live checks. With autofill and a password manager on a real phone, confirm the request sends an empty `website` field.

## References

- API 4.3 (`POST {action:"booking", token}`, with the token in the body only). Route `#/b/<token>` 4.4 (no-referrer). D-005 (`localStorage`), D-009. Rule 6.1.8 (sold-out waiters see "This item was sold").
- Copy 6.4: "Your reservation is saved, even if you don't send the message."
- Critical scenarios: **T-11** (random token), **T-14** (storage blocked: booking link still shown).

## the seller needs to do

Nothing.

## Out of scope

The WhatsApp jump (S-13) and back-out (S-14).
