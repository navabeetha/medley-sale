# D-031: Photo pipeline hardening after S-05 QA

- **Status:** Proposed (PM, 2026-11-05). Smaller option taken. Extends D-029.
- **Context:** S-05 QA (qa-log, 2026-11-05) found four S3 and several S4 issues using synthetic probes. None leaks data, but each could publish a wrong photo, lose one without saying so, or wipe the photo folder.

## Rules

1. **Raw media:** image bytes are read straight from the workbook's `xl/media` entries, never from openpyxl's re-saved copy, so EXIF orientation survives for every format (MPO, WebP and others). Orientation is then applied, and all metadata stripped as before.
2. **Unplaceable images are reported, never fatal and never silent.** An `absoluteAnchor` image or undecodable media (corrupt, EMF/WMF) goes into `skipped` with a reason. If the count of `xl/media` files differs from the count of images placed, the report says how many.
3. **Empty export guard:** if a run finds zero images while `public/photos/manifest.json` already lists items, it stops and changes nothing, unless explicitly allowed (`allow_empty`).
4. **Budgets are hard:** quality steps down to a floor of 30. If a file still doesn't fit, the run stops and names the item ID; it never writes an over-budget file.
5. **Alt text fallback** to `Brand (+ Link)` / `Brand` is for Books only (D-028 rule 3). On other tabs with no `Item`, the alt text is the ID.
6. **CI:** the Python tests run in CI as their own step (setup-python 3.12, pinned requirements; the GitHub runner no longer offers 3.9, and local runs stay on the Xcode Python 3.9). They stay out of `npm run check`, so a local venv isn't required to run the gate.
7. **Seller's review:** the contact sheet is also checked for faces, name labels, addresses and receipts, not only crops (no automated content check).
