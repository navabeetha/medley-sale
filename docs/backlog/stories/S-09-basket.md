# S-09: Basket

| | |
|---|---|
| **Points** | 2 |
| **Slice** | 2: Reserve |
| **Depends on** | S-06 |
| **Status** | Backlog |
| **Pod type** | feature |
| **Gate** | none |
| **Branch** | `S-09-basket` |

## Acceptance criteria (brief Section 8, verbatim)

- **Add** toggles with a text-based selected state. Items with quantity above 1 use a stepper up to the quantity.
- Sticky bar shows total units and survives reloads.
- A 16th unit is refused with a clear message.

## References

- Basket limit 6.3 (1 to 15 units). UX 7 basket bar (sticky, shown only when something's selected, `Reserve (n)`, respects safe-area inset. Status never by colour alone). Display 6.2 ("Join waiting list" when no free units). D-004.
- Critical scenarios: contributes to **T-09** (basket contents).

## the seller needs to do

Nothing.

## Out of scope

The form and saving (S-10, S-11).
