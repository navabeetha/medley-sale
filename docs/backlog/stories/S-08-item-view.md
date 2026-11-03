# S-08: Item view

| | |
|---|---|
| **Points** | 2 |
| **Slice** | 1: See the sale |
| **Depends on** | S-05, S-06 |
| **Status** | Backlog |
| **Pod type** | feature |
| **Gate** | Slice 1 demo follows (exit: catalogue live, D-001 proven) |
| **Branch** | `S-08-item-view` |

## Acceptance criteria (brief Section 8, verbatim)

- Shows photos, notes, price, pickup, state and product link.
- Items without a photo still look complete.
- Sold-out direct links say "Sold". Unknown IDs show a helpful message.

## References

- UX 7 Item view (scroll-snap photos, full notes, product link, pickup). Route `#/i/<id>` 4.4. Product links from rich-text cells 4.1. Display 6.2 (sold out: "Sold"). D-007, D-009.

## the seller needs to do

Nothing. The Slice 1 demo summary with 390 px screenshots goes to her after this story.

## Out of scope

Reserving from the item view beyond the existing Add behaviour (S-09).
