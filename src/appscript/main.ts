// Apps Script entry points, run from the editor's Run menu. Thin: the logic is
// in src/api/migrate.ts. Logs counts only, never names, numbers or tokens.

import { addIdColumns } from "../api/add-id-columns";
import { backOut } from "../api/back-out";
import { booking } from "../api/booking";
import { catalogue } from "../api/catalogue";
import { CATALOGUE_CACHE_KEY, handleGet } from "../api/handle-get";
import { handlePost } from "../api/handle-post";
import { colOf, migrate, scrubStaging } from "../api/migrate";
import { onClaimsEdit, type ClaimsEdit } from "../api/on-edit";
import { uuidsToBytes } from "../api/random";
import { recalculateAll } from "../api/recalc";
import { reserve } from "../api/reserve";
import { waOpened } from "../api/wa-opened";
import type { SellerDeps } from "../api/seller-sheet";
import { warmCatalogue } from "../api/warm-catalogue";
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
 * D-035 rule 3: prepares the real sheet (ID and Quantity columns, IDs). Run once
 * from the editor. Logs counts only. No BUILD COPY guard, by design.
 */
export function addIdColumnsRun(): void {
  addIdColumns(activeSpreadsheet(), { log: (l) => console.log(l) });
}

/**
 * D-034 rule 1: refreshes the cached catalogue. Not run by hand in normal use:
 * the seller adds a time-driven trigger on `warmCatalogue`, every 5 minutes, in
 * the editor's Triggers screen (no extra OAuth scope needed).
 */
export function warmCatalogueRun(): void {
  warmCatalogue({ catalogue: buildCatalogue, cache: CacheService.getScriptCache(), log: (l) => console.log(l) });
}

/**
 * Web-app GET entry (brief 4.3). Public and read-only; the logic and the cache
 * rules are in src/api/handle-get.ts. Tokens never come from the query string.
 * CATALOGUE_CACHE_KEY (re-exported from there) is the one cache key: write
 * handlers (S-11, S-14, S-15) must remove it after changing the sheet, or the
 * old catalogue is served until the cache expires (10 minutes, D-034). Photo counts are not wired yet, so
 * photos is 0 (D-030 rule 3).
 */
export { CATALOGUE_CACHE_KEY };

/** The one catalogue builder, shared by doGet and the warm job so both cache the same body. */
function buildCatalogue(): unknown {
  return catalogue(activeSpreadsheet(), {
    // Date cells arrive as midnight in the sheet's zone, so format them in that zone, not UTC (D-030 rule 6).
    formatDate: (d) => Utilities.formatDate(d, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), "yyyy-MM-dd"),
    // The seller's number lives only in Script Properties, never in the repo (D-034 rule 4).
    sellerWhatsapp: PropertiesService.getScriptProperties().getProperty("SELLER_WHATSAPP") ?? undefined,
  });
}

export function doGetRun(e?: { parameter?: Record<string, string> }): GoogleAppsScript.Content.TextOutput {
  const body = handleGet(e?.parameter ?? {}, {
    catalogue: buildCatalogue,
    cache: CacheService.getScriptCache(),
  });
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Web-app POST entry (brief 4.3). The body is text/plain JSON (no CORS preflight).
 * Thin wiring only; the rules are in src/api/reserve.ts. The script lock is what
 * makes concurrent reservations queue up one at a time (6.1 rule 6). The cache is
 * the same one doGet and the warm job use, so reserve can clear the catalogue key.
 * SITE_URL (Script Property) is the Pages URL the booking link in the WhatsApp
 * message points at; SELLER_WHATSAPP is the same property the catalogue reads.
 */
export function doPostRun(e?: { postData?: { contents?: string } }): GoogleAppsScript.Content.TextOutput {
  const props = PropertiesService.getScriptProperties();
  const body = handlePost(e?.postData?.contents, {
    reserve: (request) =>
      reserve(activeSpreadsheet(), request, {
        lock: LockService.getScriptLock(),
        cache: CacheService.getScriptCache(),
        randomBytes,
        now: () => new Date().toISOString(),
        sellerWhatsapp: props.getProperty("SELLER_WHATSAPP") ?? undefined,
        siteUrl: props.getProperty("SITE_URL") ?? "",
      }),
    // S-12: read-only, so no lock and no cache. S-14: same lock, cache and clock as reserve.
    booking: (request) =>
      booking(activeSpreadsheet(), request, {
        now: () => new Date().toISOString(),
        sellerWhatsapp: props.getProperty("SELLER_WHATSAPP") ?? undefined,
        siteUrl: props.getProperty("SITE_URL") ?? "",
      }),
    backOut: (request) =>
      backOut(activeSpreadsheet(), request, {
        ...sellerDeps(),
        sellerWhatsapp: props.getProperty("SELLER_WHATSAPP") ?? undefined,
      }),
    // S-13: one cell on Bookings, under the same lock, cache and clock.
    waOpened: (request) => waOpened(activeSpreadsheet(), request, sellerDeps()),
  });
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

/** Lock, cache, clock and SITE_URL for the seller-sheet handlers (S-15), as doPostRun gives reserve. */
function sellerDeps(): SellerDeps {
  return {
    lock: LockService.getScriptLock(),
    cache: CacheService.getScriptCache(),
    now: () => new Date().toISOString(),
    siteUrl: PropertiesService.getScriptProperties().getProperty("SITE_URL") ?? "",
  };
}

/** The part of Apps Script's edit event we use. */
interface EditEvent {
  range?: GoogleAppsScript.Spreadsheet.Range;
  oldValue?: string;
  value?: string;
}

/**
 * S-15: target of the INSTALLABLE on-edit trigger, which the seller adds from the Triggers screen
 * (from the spreadsheet; no ScriptApp call here, it would need a wider OAuth scope). Named
 * onClaimsEdit, not onEdit: onEdit would also run as a restricted simple trigger and fire twice.
 * A multi-cell edit (paste, fill-down, delete) has no single old value, so it runs the full
 * recalculation instead. Logs counts only, never names or numbers.
 */
export function onClaimsEditRun(e?: EditEvent): void {
  const range = e?.range;
  if (!range) return;
  if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) {
    // The sheet name check keeps a paste on another tab from running the repair.
    if (range.getSheet().getName() === "Claims") console.log(`multi-cell edit: recalculateAll ${JSON.stringify(recalculateAll(activeSpreadsheet(), sellerDeps()))}`);
    return;
  }
  // F9: the edited row's Claim ID, read NOW, before onClaimsEdit waits for the lock. A sort during that wait moves
  // claims between rows; the handler compares this with what the row holds once it has the lock.
  const sheet = range.getSheet();
  let claimId: number | undefined;
  if (sheet.getName() === "Claims" && range.getRow() >= 2) {
    const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] ?? [];
    const idCol = colOf(head as never, "Claim ID");
    const seen = idCol ? sheet.getRange(range.getRow(), idCol).getValue() : "";
    if (seen !== "" && Number.isFinite(Number(seen))) claimId = Number(seen); // none seen: the State comparison is the only check
  }
  const edit: ClaimsEdit = {
    tab: range.getSheet().getName(),
    row: range.getRow(),
    column: range.getColumn(),
    // The event gives strings (and undefined for a cleared or previously empty cell).
    oldValue: e.oldValue ?? null,
    newValue: e.value ?? null,
    ...(claimId === undefined ? {} : { claimId }),
  };
  const r = onClaimsEdit(activeSpreadsheet(), edit, sellerDeps());
  if (r.handled && r.reverted) console.log("onClaimsEdit: a sale was reverted");
  else if (!r.handled && r.error) console.log(`onClaimsEdit: ${r.error}`);
}

/** S-15: target of the time-driven trigger, every 10 minutes (the seller adds it in the Triggers screen). */
export function recalculateAllRun(): void {
  console.log(`recalculateAll: ${JSON.stringify(recalculateAll(activeSpreadsheet(), sellerDeps()))}`);
}

// tools/build-gas.mjs bundles this file as the global `A44` and appends top-level
// `function scrubStaging()`, `function migrateSheet()`, `function addIdColumns()`,
// `function warmCatalogue()`, `function doGet(e)`, `function doPost(e)`, `function onClaimsEdit(e)` and
// `function recalculateAll()` wrappers, because the
// editor's Run menu only lists top-level function declarations.
