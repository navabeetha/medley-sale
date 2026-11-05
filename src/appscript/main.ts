// Apps Script entry points, run from the editor's Run menu. Thin: the logic is
// in src/api/migrate.ts. Logs counts only, never names, numbers or tokens.

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

// tools/build-gas.mjs bundles this file as the global `A44` and appends top-level
// `function scrubStaging()` and `function migrateSheet()` wrappers, because the
// editor's Run menu only lists top-level function declarations.
