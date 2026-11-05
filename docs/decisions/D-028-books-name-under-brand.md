# D-028: On Books, the book name is the "Brand" column when there is no "Item" column

- **Status:** Proposed (PM, 2026-11-05). Fills a gap in brief 4.1, which says the Books name column "is mapped by header" without naming the header. Doesn't change a Section 5 decision.
- **Context:** the first live `migrateSheet` run (2026-11-05) refused with `Tab "Books" has no "Item" column`, writing nothing. The seller said the Books columns are `Author` and `Brand`, with the link on `Brand`. The tab was copied from the item layout, so `Brand` holds the book name.

## Rule

1. On every tab the item-name column is the one headed `Item`.
2. On **Books only**, if there is no `Item` column, the book name is the `Brand` column. `Author` stays the author (brief 4.1: book name first, then author).
3. Other tabs never fall back to `Brand`. There, `Brand` is the brand.
4. The product link for a book comes from the rich-text link on that same name cell (brief 4.1, unchanged).

## Cost and check

If the seller's `Brand` column on Books actually holds something other than the title, such as a publisher, the site would show it as the book name. She is asked to confirm when she next looks at the migrated copy. S-04 (catalogue API) must use the same lookup.
