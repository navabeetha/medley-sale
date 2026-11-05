# D-029: Photo pipeline edge cases

- **Status:** Proposed (PM, 2026-11-05). In each case the smaller option was taken, and none changes a Section 5 decision.
- **Context:** the S-05 red step left these behaviours open (brief 7.1 doesn't cover them).

## Rules

1. **Upscaling:** the full image is never upscaled, so a smaller source keeps its size. The thumbnail is always 144 × 144.
2. **Alt text:** every image of an item gets the item name (on Books, the name under `Brand (+ Link)`, per D-028).
3. **Stale files:** `public/photos/` is fully owned by the tool. A run removes any `.webp` there that the new manifest doesn't list, so a photo the seller deletes from the sheet disappears on the next run and push (brief 7.1: "rerunning the tool and pushing publishes them"). The tool never deletes anything outside its output folder.
4. **Duplicate IDs:** if two rows share an `ID`, the tool stops with an error naming the tab, the rows and the ID, and writes nothing. IDs come from S-03 and should be unique, so a duplicate means something is wrong.
5. **Image anchored across several rows:** it belongs to the row of its top-left anchor.
6. **CI:** the Python tests run locally (`npm run test:photos`), not in `npm run check`, until S-05 lands. The committed output is still budget-checked in CI by `npm run size`.
