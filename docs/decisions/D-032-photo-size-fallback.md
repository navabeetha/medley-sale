# D-032: A photo that won't fit at 1000 px is shrunk, not refused

- **Status:** Proposed (PM, 2026-11-05). Amends D-031 rule 4. Doesn't change a Section 5 decision.
- **Context:** the first real run of `npm run photos` on the build copy's export stopped at photo 1 of `I-0020`. Two of the 31 photos are detail-heavy close-ups: at 1000 px they're 150 KB and 136 KB even at quality 30, against the 120 KB budget (8.1). The other 29 fit easily.

## Rule

1. As before, the full image starts at longest side 1000 px and steps quality down to the floor of 30.
2. If it still doesn't fit, its longest side shrinks by 10% and the quality steps repeat, down to **600 px at the smallest**. A phone screen is about 400 px wide, so 600 px is still sharp.
3. Only if it doesn't fit at 600 px does the run stop, naming the item, with nothing written (D-031 rule 4). At about 0.8 bits per pixel for quality 30, this shouldn't happen with real photos.
4. The manifest's `width` and `height` are the final size, as before. The thumbnail is unaffected.
5. The image is never blurred or smoothed to save bytes (brief 7.1: "never hide scratches or stains").

## Options not taken

- Raising the 120 KB budget would slow the site on phones, and the budget is CI-enforced.
- Smoothing the image would hide wear the buyer should see.
