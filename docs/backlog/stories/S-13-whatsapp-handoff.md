# S-13: WhatsApp handoff

| | |
|---|---|
| **Points** | 2 |
| **Slice** | 2: Reserve |
| **Depends on** | S-12 |
| **Status** | Backlog |
| **Pod type** | feature |
| **Gate** | Slice 2 demo follows (exit: reserve through to the WhatsApp URL). The `wa.me` format is checked at G1 |
| **Branch** | `S-13-whatsapp-handoff` |

## Acceptance criteria (brief Section 8, verbatim)

- Message matches Section 2.8, correctly encoded for emoji, ₹ and line breaks.
- The browser goes to WhatsApp once, after saving. The button is always present, and returning doesn't reopen WhatsApp by itself.
- Records `WhatsApp opened` where possible.
- A 15-unit booking with long titles stays under the URL limit and keeps the private link.
- Tests assert the URL. No agent sends a real message.

## References

- Message 2.8 (no seller name. Book name first, then author, 4.1). URL limit 6.3 (under 2,000 characters, "…and N more"). API `waOpened` 4.3.
- D-008 (save first, then same-tab navigation, with a **Send on WhatsApp** button always shown), D-011. Hard rule 11.6.3. Research note 12 (expected `wa.me` format, not confirmed from a primary source).
- Message building lives in `src/domain/`.
- Critical scenarios: **T-13**, and the message half of **T-09** and **T-10**.

## the seller needs to do

Nothing now. At G1 she checks the jump to WhatsApp on her own phone.

## Out of scope

Automatic sending (not planned) and "Ask about this item" (N-04).
