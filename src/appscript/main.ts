// Apps Script entry points, run from the editor's Run menu. Thin: the logic is
// in src/api/migrate.ts. Logs counts only, never names, numbers or tokens.

import { catalogue } from "../api/catalogue";
import { CATALOGUE_CACHE_KEY, handleGet } from "../api/handle-get";
import { migrate, scrubStaging } from "../api/migrate";
import { uuidsToBytes } from "../api/random";
import { activeSpreadsheet } from "./adapter";

/**
 * Token randomness (D-005, needs >= 128 bits). Apps Script has no
 * crypto.getRandomValues. Utilities.getUuid() returns a random (v4) UUID, which
 * is the best source the platform offers; Google does not document it as
 * cryptographic-grade. Each UUID carries 122 random bits; we drop its fixed
 * version and variant nibbles (120 bits kept) and join as many UUIDs as needed,
 * so 16 bytes (128 bits) come from at least two UUIDs (240 bits available).
 */
function randomBytes(n: number): Uint8Array {
  const uuids: string[] = [];
  for (let have = 0; have < n * 2; have += 30) uuids.push(Utilities.getUuid());
  return uuidsToBytes(uuids, n);
}

export function scrubStagingRun(): void {
  const r = scrubStaging(activeSpreadsheet(), { log: (l) => console.log(l) });
  console.log(
    `scrubStaging done: ${r.peopleReplaced} people, ${r.numbersRemoved} numbers, ${r.commentsRemoved} notes. ` +
      "Threaded comments can't be removed by script: open each comment (and resolved comments via the comment history) and delete it.",
  );
}

export function migrateSheetRun(): void {
  // Never pass allowUnscrubbed here: it exists for unit tests only. From the
  // editor, migrate must always refuse a sheet the scrub has not cleaned.
  migrate(activeSpreadsheet(), {
    randomBytes,
    now: () => new Date().toISOString(),
    log: (l) => console.log(l),
  });
}

/**
 * Web-app GET entry (brief 4.3). Public and read-only; the logic and the cache
 * rules are in src/api/handle-get.ts. Tokens never come from the query string.
 * CATALOGUE_CACHE_KEY (re-exported from there) is the one cache key: write
 * handlers (S-11, S-14, S-15) must remove it after changing the sheet, or the
 * old catalogue is served for up to 30 s. Photo counts are not wired yet, so
 * photos is 0 (D-030 rule 3).
 */
export { CATALOGUE_CACHE_KEY };

export function doGetRun(e?: { parameter?: Record<string, string> }): GoogleAppsScript.Content.TextOutput {
  const body = handleGet(e?.parameter ?? {}, {
    // Date cells arrive as midnight in the sheet's zone, so format them in that zone, not UTC (D-030 rule 6).
    catalogue: () =>
      catalogue(activeSpreadsheet(), {
        formatDate: (d) => Utilities.formatDate(d, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), "yyyy-MM-dd"),
      }),
    cache: CacheService.getScriptCache(),
  });
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

// tools/build-gas.mjs bundles this file as the global `A44` and appends top-level
// `function scrubStaging()`, `function migrateSheet()` and `function doGet(e)` wrappers, because the
// editor's Run menu only lists top-level function declarations.
