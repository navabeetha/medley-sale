// S-15: the installable on-edit trigger's handler (brief 2.7, 6.1 rules 3, 4, 6, 7, 8; D-003, D-010,
// D-026, D-038). The adapter maps the edit event to a ClaimsEdit (src/appscript/main.ts) and installs
// nothing itself: the seller adds the trigger from the editor's Triggers screen (a wider OAuth scope
// would be needed to do it from code).
//
// D-026.2: the event's old value is the only record of the State before the edit, and both the sale
// check and previousRole must use the claims AS THEY WERE BEFORE it. Passing the after-edit state
// would make every sale look like an oversell and revert it. The grid is authoritative for the new
// State: it is re-read under the lock, so a second quick edit is never overwritten with a stale one.
import { claimColumns, CLAIMS, NOT_A_STATE, applyItem, itemInput, locked, readClaims, readItems, readTokens, repairAll, rolesOf, toInput, type SellerDeps } from "./seller-sheet";
import type { CellValue, Spreadsheet } from "./sheet";
import { isBlank } from "./migrate";
import { canMarkSold, type ClaimState } from "../domain/queue";

export interface ClaimsEdit {
  tab: string;
  /** 1-based row and column of the edited cell. */
  row: number;
  column: number;
  oldValue: CellValue;
  newValue: CellValue;
}

export type EditResult =
  | { handled: false; error?: "busy" }
  | { handled: true; reverted: false }
  | { handled: true; reverted: true; reason: string };

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
    const rawState = claimsTab.getGrid()[edit.row - 1]?.[edit.column - 1];
    const blank = (v: CellValue | undefined): CellValue | null => (isBlank(v) ? null : v!);
    if (blank(rawState) !== blank(edit.newValue)) {
      repairAll(ss, claimsTab, deps, markWrote);
      return { handled: true, reverted: false };
    }
    if (blank(edit.newValue) === null) return { handled: false }; // an emptied cell is not a claim edit
    // QA F3: a typo'd State (e.g. "Sold ") is not a claim state. Say so on the cell and write nothing else.
    if (!isState(edit.newValue)) {
      markWrote();
      claimsTab.setNote(edit.row, edit.column, NOT_A_STATE);
      return { handled: false };
    }

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
        claimsTab.setNote(edit.row, edit.column, verdict.reason);
        if (oldKnown) return { handled: true, reverted: true, reason: verdict.reason };
        note = verdict.reason;
      }
    }
    // An accepted edit removes the explanation left by an earlier refusal or typo.
    markWrote();
    claimsTab.setNote(edit.row, edit.column, note);

    const previousRoles = rolesOf(item, oldKnown ? before : own.map((c) => toInput(c, null)), deps.now());
    const leftSold = oldKnown && edit.oldValue === "sold" && edited.state !== "sold" ? edited.claimId : null;
    applyItem({ ss, claims: sheet, deps, now: deps.now(), markWrote }, item, previousRoles, readTokens(ss), leftSold);
    return { handled: true, reverted: false };
  });
  return out.busy ? { handled: false, error: "busy" } : out.value;
}
