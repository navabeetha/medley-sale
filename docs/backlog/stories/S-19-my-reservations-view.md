# S-19: One "My reservations" view

**Points:** 3. **Slice:** 3 (before G1 sign-off). **Source:** the seller at G1, 2026-11-07.
**Depends on:** S-12, S-14, and the G1-fixes branch (`backedOutUrl`, pending back-out feedback, not-found clean-up).

> The seller: "the forget my details comes on the reserve page on the second go? can we have this button on my reservations page? also why do we have two reservations under my reservations? let's just have a single view of: all reservations of mine, a list of back outs, buttons to inform each, maybe a section for my details at the bottom with name and number and button to clear personal details." Also: "check that removing my details should not wipe the reservations, only remove phone and name."

## Acceptance criteria

1. **Route and link.** The header "My reservations" link opens `#/mine`, one page for every booking saved on this device (`medley-sale:bookings:v1`). It shows whenever the list has a valid token. The per-booking page `#/b/<token>` stays, because WhatsApp links point there.
2. **One request.** A new read-only API action `mine`, with `{action:"mine", tokens:[...]}` in a text/plain POST body:
   - Up to 20 non-empty string tokens are allowed. Anything else answers `invalid-request`, with no lock.
   - The reply has the merged units from all found bookings, each carrying its booking's token (the client sent them), and `notFound`, the tokens that matched nothing. The site drops those from storage, as in G1-fixes item 4.
   - Never return data for a token that wasn't sent. An unknown token is only listed in `notFound`.
3. **Sections:**
   - **Reserved:** the units held or waiting across all bookings, each with **Back out**, using the same confirm and "Backing out…" behaviour as the booking page, sent with that unit's own token.
   - **Sold to you** (if any).
   - **Backed out:** the units the buyer backed out of.
4. **One message per section.**
   - **"Send the details to the seller"** sits under Reserved. Its `whatsappUrl` combines every reserved or waiting item in one buyer-voice message, in the 2.8 style, with brands via `title()`. It ends with each booking's link line, under the 2,000-character cap, with "…and N more".
   - **"Tell the seller you backed out"** sits under Backed out. Its `backedOutUrl` lists every backed-out item across bookings.
   - Both are null when their section is empty or `SELLER_WHATSAPP` is invalid.
5. **My details** (at the bottom):
   - Shows the saved name and number (`medley-sale:buyer:v1`), and **Forget my details**, which removes only that key.
   - A test pins that `medley-sale:bookings:v1` and the reservations on screen are untouched afterwards.
   - The section is hidden when nothing is saved.
   - The Forget button is removed from the reserve screen. The "remember my details" choice stays there.
6. **Behaviour:**
   - Storage blocked or corrupt: no crash, and the page says there are no saved reservations.
   - textContent only.
   - Tokens only in the hash and POST bodies.
   - Works at 320 and 390 px, with controls at least 44 px.

## Out of scope
- Merging bookings on the server. Each Reserve still makes its own booking, and the view merges them on the device.
- Cross-device lists.

## Notes
- Reuse the `src/api/booking.ts` per-token reading, plus `buildWhatsappUrl` and the compose logic in `src/domain/message.ts`.
- `mine` goes through `PostDeps` in `src/api/handle-post.ts` and is wired in `src/appscript/main.ts`.
