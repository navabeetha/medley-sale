# S-05: Photo pipeline

| | |
|---|---|
| **Points** | 2 |
| **Slice** | 1: See the sale |
| **Depends on** | S-03 |
| **Status** | Ready (2026-11-05) |
| **Pod type** | feature |
| **Gate** | Needs G0.3 and an export of the scrubbed build copy in `private/` ([D-019](../../decisions/D-019-photo-export-from-scrubbed-copy.md)) |
| **Branch** | `S-05-photo-pipeline` |

## Acceptance criteria (brief Section 8, verbatim)

- Output matches Section 7.1, with a fixture test for removal of GPS data.
- Produces a contact sheet so a person can check crops.

## References

- Photo pipeline 7.1: read `.xlsx` from `private/` and map images by anchor to row and by `ID` to item. Respect orientation, strip **all** metadata. Thumbnail 144 × 144, smart-cropped, 12 KB or less. Full image longest side 1000 px, 120 KB or less. Light levels only. WebP. `width`, `height`, `alt`, lazy loading. Python with `openpyxl` is fine.
- Audit 3 (31 photos, mostly portrait). Budgets 8.1. Lives in `tools/`. Output in `public/photos/`.
- Critical scenarios: **T-16**.

## Notes

- The fixture image with GPS data must be synthetic (generated, or a non-personal image with fake GPS added). Never use a real export in `test/fixtures/`.
- The contact sheet is for review, so keep it out of `public/` (for example in `private/`, gitignored).

## the seller needs to do

Export the scrubbed build copy as `.xlsx` into `private/` when asked. Review the crops on the contact sheet (formally at G1).

## Out of scope

Displaying photos in the site (S-06, S-08).
