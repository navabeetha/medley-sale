# D-038: Fast path to live reserving

- **Status:** Accepted (the seller, 2026-11-06).
- **Why:** the seller wants the customer journey (reserve, back out, next person moves up) live as soon as possible. The full remaining MVP (26 points) was estimated at about a week; this path is about 20 points.

## Decisions

1. **Build now, in this order:** S-09 basket, S-10 reservation form, S-11 reserve API, S-12 booking page, S-13 WhatsApp handoff, S-14 back out, S-15 seller sheet workflow. Then G1 (the seller tries staging on her phone), S-17 QA and privacy pass, and S-18 cutover (G2).
2. **Postponed until after cutover:** S-07 filter and search, S-08 item view, S-16 seller email summary. Until S-16 ships, the seller checks the sheet's To do tab for new reservations. This is a runbook note at G2.
3. **S-17 no longer depends on S-08.** It covers the screens that exist at cutover. The item view gets its own privacy check when it ships.
4. **Two tracks in parallel (brief 10.1):** an API track (S-11, S-15, the API parts of S-12 and S-14) that alone may change `src/domain/` and the sheet schema, and a UI track (S-09, S-10, the screens of S-12 to S-14) that changes only `src/site/`, `public/` and e2e tests. A UI story that needs domain logic waits for the API track to merge it.
5. **Seller notes carried in:** the reserve message names the brand after the item name (S-13 seller note).
