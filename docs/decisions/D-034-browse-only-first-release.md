# D-034: Browse-only first release, with the catalogue kept warm

- **Status:** Accepted (the seller, 2026-11-05).
- **Context:**
  - D-033 measured warm cache misses of 8 to 13 s against hits of about 1.7 s.
  - The seller wants a basic version out by the evening of 2026-11-06. She'll decide later whether online reserving is worth a few more days before the public link goes out.

## Decisions

1. **Keep the catalogue warm.** A time-driven job, `warmCatalogue`, rebuilds the cached catalogue every 5 minutes. The cache lifetime becomes 10 minutes, so a visitor almost always gets a hit (about 2 s). Every write still clears it (4.3; S-11, S-14 and S-15).
   - Until S-15's on-edit trigger, the seller's own edits in the sheet take up to 5 minutes to show.
   - This replaces the brief's "short server cache" (30 s); the seller accepted the trade-off.
2. **First release is Slice 1 only:** S-06 (catalogue screen), S-07 (filter and search) and S-08 (item view). There's no basket or online reserving; those are Slice 2.
   - Each item shows a **"Message to reserve"** link: a `wa.me` link to the seller, prefilled with the item's name. Reserving works as it does today, by WhatsApp.
3. **Light "early version" handling:**
   - A loading line ("Loading the sale… this can take a few seconds").
   - A friendly fallback if the API fails or returns non-JSON, with the WhatsApp link.
   - A one-line note at the top: "This is an early version. If anything looks odd, just message me."
4. **The seller's number is never in the repo** (hard rule 1, 4.2). It lives in Script Properties as `SELLER_WHATSAPP`. The catalogue response gains one top-level field, `contactUrl`: a `wa.me` URL with no prefilled text, or null if unset. The site adds `?text=` per item.
   - This amends D-030: the item keys are unchanged, and `contactUrl` is a sibling of `items`.
5. **The data source for the release** (build copy or real sheet) is the seller's decision. It's asked separately, because it touches the real sheet before G2.
