# S-04: Catalogue API

| | |
|---|---|
| **Points** | 2 |
| **Slice** | 1: See the sale |
| **Depends on** | S-02, S-03 |
| **Status** | Ready (2026-11-05) |
| **Pod type** | feature |
| **Gate** | Live checks need G0.3 complete. **Stop condition:** if Apps Script can't work from Pages, stop and ask the seller (11.5) |
| **Branch** | `S-04-catalogue-api` |

## Acceptance criteria (brief Section 8, verbatim)

- Returns the fields in Section 4.3, across all four tabs, with correct Books mapping, blank price as null and date cells as ISO dates.
- An automated check fails if the response contains anything from `Claims` or `Bookings`.
- CORS works from the Pages origin. This is a go or no-go check for D-001, so raise problems right away.
- Records real cold and warm response times in the decision log. Warm catalogue responses over 3 seconds are raised to the seller, with the snapshot option in Section 9 as a mitigation.

## References

- API 4.3 (`GET ?action=catalogue`: item fields, `unitsLeft`, `waitingCount`, photo count. Never names or numbers. Excludes sold-out items. Short server cache, cleared on any write). Books mapping 4.1. POST as `text/plain` 4.3.
- D-001, D-009, D-011, D-015. Risks 10.3 (slow, CORS). N-05 is the mitigation.
- Timings are recorded as a new decision file ([D-020](../../decisions/D-020-measurements-recorded-here.md)).
- Critical scenarios: **T-12** (catalogue response scan).

## the seller needs to do

Possibly deploy the staging web app the first time (to authorise it under her account), if an agent can't do that via clasp. The PM walks her through it in 11.7 format if needed. If warm responses are over 3 seconds, she decides on N-05.

## Out of scope

Reserve, booking and back-out calls, and UI.
