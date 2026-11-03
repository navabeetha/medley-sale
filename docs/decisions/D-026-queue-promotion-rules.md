# D-026: Queue engine promotion, role source, and unavailable items

- **Status:** Proposed (PM, 2026-11-03). Smaller option taken in each case; none changes a Section 5 decision.
- **Context:** S-02 QA review (docs/qa/qa-log.md, 2026-11-03, findings F1 to F5).

## 1. What counts as a promotion (rule 6.1.3)

- `previousRole` is `"holder" | "waiting" | "sold" | "ended" | null`. `null` means only "created in this write".
- A claim is **promoted** (stamped `Promoted at`, listed for the `To do` tab) when it becomes a holder and its previous role was anything except `"holder"` or `null`.
- So: holders from creation are not promoted (they saw "Reserved" on their confirmation). A waiter moving up is promoted. A claim restored from `sold` or `released` that lands as a holder **is** promoted, so the seller gets a `To do` row.
- **Accepted cost:** after the seller undoes their own mistake (T-06), the original holder regaining its place also gets a `To do` row. One extra message beats a hold nobody acts on (D-010: holds don't expire).

## 2. Where `previousRole` comes from

- No new sheet column. Callers (S-11, S-14, S-15) run `recalculate` on the claims **as they were before the change**, under the script lock, and pass each claim's resulting role (or `"sold"` / `"ended"` for non-active claims) as `previousRole`.
- `canMarkSold` likewise takes the claims as they were **before** the edit. S-15's on-edit trigger must reconstruct that (the edit's old value is available in the edit event).

## 3. Quantity 0 and invalid quantities

- `soldOut` is true when at least one unit is sold and none are left: shown as "Sold" (6.2).
- Quantity 0 means "not for sale": the engine reports `unavailable: true`, the item is hidden from the list like a sold-out item, and a direct link says it isn't available. Nobody holds it. Existing claims are kept in line as waiting, so restoring the quantity brings the line back in order. **The API (S-11) must refuse new reservations on an unavailable item** (skip it, as for sold-out); the engine does not block them.
- **Seller note for G1:** a temporarily mistyped Quantity demotes the holders; fixing it promotes them again, with new `To do` rows. Line order is never lost.
- A quantity that isn't a whole number of 0 or more (blank is already set to 1 by S-03) is treated as unavailable, and `canMarkSold` refuses with a plain reason. Nobody gets a hold on bad data.
