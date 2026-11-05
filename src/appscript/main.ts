// Apps Script entry points, run from the editor's Run menu. Thin: the logic is
// in src/api/migrate.ts. Logs counts only, never names, numbers or tokens.

import { catalogue } from "../api/catalogue";
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

const CATALOGUE_CACHE_KEY = "catalogue";
/** Short on purpose: a reservation shows up within half a minute even if a write forgets to clear it. */
const CATALOGUE_CACHE_SECONDS = 30;

function json(body: unknown): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Web-app GET entry (brief 4.3). Public and read-only: `?action=catalogue`
 * returns the catalogue JSON, anything else a JSON error. No token is involved,
 * and none may ever be read from the query string (tokens go in POST bodies).
 * The built catalogue is cached in CacheService (one key, 30 s). Write handlers
 * (S-11, S-14, S-15) must remove CATALOGUE_CACHE_KEY after changing the sheet
 * (D-030 rule 7). Photo counts are not wired yet, so photos is 0 (D-030 rule 3).
 */
export function doGetRun(e?: { parameter?: Record<string, string> }): GoogleAppsScript.Content.TextOutput {
  if (e?.parameter?.action !== "catalogue") return json({ error: "unknown action" });
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CATALOGUE_CACHE_KEY);
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  const body = JSON.stringify(catalogue(activeSpreadsheet()));
  // CacheService values are capped at 100 KB; skip caching rather than fail if it is bigger.
  if (body.length < 90000) cache.put(CATALOGUE_CACHE_KEY, body, CATALOGUE_CACHE_SECONDS);
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

// tools/build-gas.mjs bundles this file as the global `A44` and appends top-level
// `function scrubStaging()`, `function migrateSheet()` and `function doGet(e)` wrappers, because the
// editor's Run menu only lists top-level function declarations.
