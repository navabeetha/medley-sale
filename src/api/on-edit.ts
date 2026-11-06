// S-15: the installable on-edit trigger's handler (brief 2.7, 6.1 rules 3, 4, 6, 7, 8; D-003, D-010,
// D-026, D-038). The adapter maps the edit event to a ClaimsEdit (src/appscript/main.ts) and installs
// nothing itself: the seller adds the trigger from the editor's Triggers screen (a wider OAuth scope
// would be needed to do it from code).
//
// D-026.2: the event's old value is the only record of the State before the edit, and both the sale
// check and previousRole must use the claims AS THEY WERE BEFORE it. Passing the after-edit state
// would make every sale look like an oversell and revert it. The grid is authoritative for the new
// State: it is re-read under the lock, so a second quick edit is never overwritten with a stale one.
import { claimColumns, CLAIMS, BLANK_STATE, NOT_A_STATE, canWriteStateNote, isOurStateNote, applyItem, itemInput, locked, readClaims, readItems, readTokens, repairAll, rolesOf, toInput, type SellerDeps } from "./seller-sheet";
import type { CellValue, Spreadsheet } from "./sheet";
import { colOf, isBlank } from "./migrate";
import { text } from "./cell-text";
import { canMarkSold, isRefusalReason, type ClaimState } from "../domain/queue";

export interface ClaimsEdit {
  tab: string;
  /** 1-based row and column of the edited cell. */
  row: number;
  column: number;
  oldValue: CellValue;
  newValue: CellValue;
  /**
   * F9: the Claim ID on the edited row as the adapter read it when the trigger fired, BEFORE it waited for the lock
   * (a sort during the wait is the race). Absent: only the State comparison below guards against a sort.
   */
  claimId?: number;
}

export type EditResult =
  | { handled: false; error?: "busy" }
  | { handled: true; reverted: false }
  | { handled: true; reverted: true; reason: string };

/** Between her note and our reason in a combined State note. */
const SEP = "\n\n— ";

const isState = (v: unknown): v is ClaimState => v === "active" || v === "released" || v === "sold";

export function onClaimsEdit(ss: Spreadsheet, edit: ClaimsEdit, deps: SellerDeps): EditResult {
  // Only a State cell of a Claims data row is ours. The header is read before the lock, only to find
  // the State column by name; every data read and every write happens inside the lock.
  if (edit.tab !== CLAIMS || edit.row < 2) return { handled: false };
  const claimsTab = ss.getTab(CLAIMS);
  if (!claimsTab || claimColumns(claimsTab)["State"] !== edit.column) return { handled: false };

  const out = locked(ss, deps, (markWrote): EditResult => {
    // QA F2: the event carries a row number, not a claim. If the seller sorted Claims before this ran,
    // that row may hold another claim, so the grid's State there no longer matches what was typed.
    // Then we can't tell which claim was edited: repair everything exactly as the timed job does
    // (D-039: previous role = current role, so nobody is stamped; the accepted gap).
    const grid = claimsTab.getGrid();
    const rawState = grid[edit.row - 1]?.[edit.column - 1];
    const blank = (v: CellValue | undefined): CellValue | null => (isBlank(v) ? null : v!);
    // F9: a sort that leaves the same State word on the row fools the comparison above, so when the adapter sent the
    // Claim ID it saw, the row must still hold exactly that claim. No Claim ID on the row now counts as different.
    const idCol = colOf(grid[0] ?? [], "Claim ID");
    const idNow = text(grid[edit.row - 1]?.[idCol - 1]);
    const otherClaim = edit.claimId !== undefined && (idNow === null || Number(idNow) !== edit.claimId);
    if (otherClaim || blank(rawState) !== blank(edit.newValue)) {
      repairAll(ss, claimsTab, deps, markWrote);
      return { handled: true, reverted: false };
    }
    if (blank(edit.newValue) === null) {
      // F8: an emptied cell is not a claim edit, but on a row with a Claim ID it says why the claim has gone quiet.
      const had = claimsTab.getNote(edit.row, edit.column);
      if (idNow !== null && had !== BLANK_STATE && canWriteStateNote(had)) {
        markWrote();
        claimsTab.setNote(edit.row, edit.column, BLANK_STATE);
      }
      return { handled: false };
    }
    // QA F3: a typo'd State (e.g. "Sold ") is not a claim state. Say so on the cell and write nothing else.
    if (!isState(edit.newValue)) {
      if (idNow === null) return { handled: false }; // a row with no Claim ID is not a claim row: no note
      if (canWriteStateNote(claimsTab.getNote(edit.row, edit.column))) {
        markWrote();
        claimsTab.setNote(edit.row, edit.column, NOT_A_STATE);
      }
      return { handled: false };
    }
    // Q2: a valid State change is accepted, and what the catalogue shows (waitingCount) may change with it even if we
    // end up writing nothing, so the cache is always cleared.
    markWrote();

    const sheet = readClaims(claimsTab);
    // The edited claim is the one on the edited row, read afresh under the lock; everything after that
    // goes by Claim ID (risk 10.3). A row with no Claim ID or no valid State is not a claim.
    const edited = sheet.rows.find((c) => c.row === edit.row);
    if (!edited) return { handled: false };
    const item = readItems(ss).get(edited.itemId);
    if (!item) return { handled: false };

    const own = sheet.rows.filter((c) => c.itemId === item.id);
    const oldKnown = isState(edit.oldValue);
    // QA F1: with no usable oldValue (the event can omit it, e.g. a paste) there is no "before". Never write
    // a non-State value back; the new State stands and the item is recalculated from the grid, with each
    // claim's previous role = its current role (as the timed job: no stamp is invented, D-039).
    // Otherwise the claims as they were before the edit: this one at oldValue.
    const before = own.map((c) => toInput(c, null, c.claimId === edited.claimId && oldKnown ? (edit.oldValue as ClaimState) : undefined));

    // Rule 6.1.7: a sale the quantity can't cover is put back, with the reason in a cell note. Without
    // an oldValue there is nothing to put back, so the sale stays and only the note is left.
    let note = "";
    if (edited.state === "sold" && edit.oldValue !== "sold") {
      const asBefore = oldKnown ? before : own.map((c) => toInput(c, null, c.claimId === edited.claimId ? "active" : c.state));
      const verdict = canMarkSold(itemInput(item), asBefore, edited.claimId);
      if (!verdict.ok) {
        markWrote();
        if (oldKnown) claimsTab.setCell(edit.row, edit.column, edit.oldValue);
        // Q1: her own note stays; the sale is still put back.
        // Her own note stays and ours goes after it (append, never overwrite); a repeat adds nothing.
        const had = claimsTab.getNote(edit.row, edit.column);
        const suffix = `${SEP}${verdict.reason}`;
        const combined = canWriteStateNote(had) ? verdict.reason : had!.endsWith(suffix) ? had! : had + suffix;
        if (combined !== had) claimsTab.setNote(edit.row, edit.column, combined);
        if (oldKnown) return { handled: true, reverted: true, reason: verdict.reason };
        note = combined;
      }
    }
    // An accepted edit removes the explanation left by an earlier refusal, typo or blank, but only OURS (F10):
    // a note the seller wrote herself stays.
    if (note !== "") {
      markWrote();
      claimsTab.setNote(edit.row, edit.column, note);
    } else {
      const had = claimsTab.getNote(edit.row, edit.column);
      const cut = had === null ? -1 : had.lastIndexOf(SEP);
      if (isOurStateNote(had)) {
        markWrote();
        claimsTab.setNote(edit.row, edit.column, "");
      } else if (cut >= 0 && isRefusalReason(had!.slice(cut + SEP.length))) {
        markWrote();
        claimsTab.setNote(edit.row, edit.column, had!.slice(0, cut)); // only our suffix; her text stays byte for byte
      }
    }

    const previousRoles = rolesOf(item, oldKnown ? before : own.map((c) => toInput(c, null)), deps.now());
    const leftSold = oldKnown && edit.oldValue === "sold" && edited.state !== "sold" ? edited.claimId : null;
    applyItem({ ss, claims: sheet, deps, now: deps.now(), markWrote }, item, previousRoles, readTokens(ss), leftSold);
    return { handled: true, reverted: false };
  });
  return out.busy ? { handled: false, error: "busy" } : out.value;
}
