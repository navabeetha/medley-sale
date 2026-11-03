# A44 Medley Garage Sale

A very light, mobile-first page for a one-off neighbourhood garage sale. Neighbours open a link from the residents' WhatsApp group, reserve items (with an automatic waiting list), back out if they need to, and message the seller on WhatsApp. The seller keeps working in a private Google Sheet.

- Static site on GitHub Pages, vanilla TypeScript, no client framework.
- Data lives in a private Google Sheet, behind an Apps Script web app.

**The full specification is [BUILD_BRIEF.md](BUILD_BRIEF.md).** Treat it as read-only. Only the owner can change it.

## Hard rules (brief Section 11.6)

> **This repo is PUBLIC. Anything committed here, including in history, is visible to anyone.**

1. **Never commit** the seller's number, buyer names or numbers, booking tokens, secrets, sheet exports, sheet links or sheet IDs.
2. Fixtures and examples use **synthetic people only**, with `+91 90000 000xx`-style numbers.
3. Agents never message real people. WhatsApp checks only assert URLs.
4. Agents don't read or edit the real sheet before Gate G2. Exports go in `private/` (gitignored). The build copy is used only after its scrub has run and been checked.
5. Stay light. A new runtime dependency needs a one-line reason, and client JS needs a strong one.

## Repo layout (brief Section 11.1)

```text
BUILD_BRIEF.md        specification (read-only)
CLAUDE.md             rules and conventions for the dev agents
docs/
  runbook.md          human gate steps (G0, G1) and the cutover runbook (S-18)
  decisions/          new decisions, D-016 onwards (D-001 to D-015 are in the brief)
  backlog/
    stories/          one file per story, e.g. S-11-reserve-api.md
    STATUS.md         the board, maintained by the PM
    slice-N.md        demo notes and retro per slice
  qa/                 QA log, scenario results, bug reports
src/                  domain/, api/, appscript/, site/   (created in S-01)
public/               index.html, CSS, processed photos  (created in S-01)
tools/                photo pipeline                     (created in S-05)
test/                 unit/, e2e/, fixtures/ (synthetic only)
private/              gitignored: exports only, never committed
```

## Status

See [docs/backlog/STATUS.md](docs/backlog/STATUS.md).
