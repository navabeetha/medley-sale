# S-06: Catalogue screen

| | |
|---|---|
| **Points** | 3 |
| **Slice** | 1: See the sale |
| **Depends on** | S-04 |
| **Status** | Backlog |
| **Pod type** | feature |
| **Gate** | none |
| **Branch** | `S-06-catalogue-screen` |

## Acceptance criteria (brief Section 8, verbatim)

- Rows follow Section 6.2 and Section 7, including "Ask", "3 left" and pickup labels.
- Catalogue is cached in `localStorage`, shown right away and refreshed. Copes when storage is blocked.
- Fails gracefully if the API is down.
- No horizontal scroll from 320 px.

## References

- Public display 6.2 (including sort order: free units first, then reserved, in sheet order). UX 7 (row, loading skeleton, errors with retry, 44 px targets, 360 px first, max width 640 px, AA contrast, status never shown by colour alone, reduced motion).
- D-006 ("Pick up anytime" and "Pick up from 2 Dec"), D-007 (text-first, 72 px thumbnails, books text-only), D-009, D-012 (title). Copy 6.4 (keep "All prices negotiable" and the Books note). `textContent` only (6.3). Meta tags 4.4.
- Critical scenarios: **T-14** (storage blocked), **T-12** (page source scan).

## the seller needs to do

Nothing (reviewed at the Slice 1 demo).

## Out of scope

Filters and search (S-07), item view (S-08), and the Add action (S-09).
