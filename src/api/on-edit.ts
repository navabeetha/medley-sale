// S-15: the installable on-edit trigger's handler (brief 2.7, 6.1 rules 3, 4, 6, 7, 8; D-003, D-010,
// D-026, D-038). The adapter maps the edit event to a ClaimsEdit (src/appscript/main.ts) and installs
// nothing itself: the seller adds the trigger from the editor's Triggers screen (a wider OAuth scope
// would be needed to do it from code).
//
// D-026.2: the event's old value is the only record of the State before the edit, and both the sale
// check and previousRole must use the claims AS THEY WERE BEFORE it. Passing the after-edit state
// would make every sale look like an oversell and revert it. The grid is authoritative for the new
// State: it is re-read under the lock, so a second quick edit is never overwritten with a stale one.
import { claimColumns, CLAIMS, applyItem, itemInput, locked, readClaims, readItems, readTokens, rolesOf, toInput, type SellerDeps } from "./seller-sheet";
import type { CellValue, Spreadsheet } from "./sheet";
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
    const sheet = readClaims(claimsTab);
    // The edited claim is the one on the edited row, read afresh under the lock; everything after that
    // goes by Claim ID (risk 10.3). A row with no Claim ID or no valid State is not a claim.
    const edited = sheet.rows.find((c) => c.row === edit.row);
    if (!edited) return { handled: false };
    const item = readItems(ss).get(edited.itemId);
    if (!item) return { handled: false };

    // The claims as they were before the edit: this one at oldValue (dropped if that was not a State).
    const own = sheet.rows.filter((c) => c.itemId === item.id);
    const before = own.flatMap((c) => {
      if (c.claimId !== edited.claimId) return [toInput(c, null)];
      return isState(edit.oldValue) ? [toInput(c, null, edit.oldValue)] : [];
    });

    // Rule 6.1.7: a sale the quantity can't cover is put back, with the reason in a cell note.
    if (edited.state === "sold" && edit.oldValue !== "sold") {
      const verdict = canMarkSold(itemInput(item), before, edited.claimId);
      if (!verdict.ok) {
        markWrote();
        claimsTab.setCell(edit.row, edit.column, edit.oldValue);
        claimsTab.setNote(edit.row, edit.column, verdict.reason);
        return { handled: true, reverted: true, reason: verdict.reason };
      }
    }
    // An accepted edit removes the explanation left by an earlier refusal.
    markWrote();
    claimsTab.setNote(edit.row, edit.column, "");

    const previousRoles = rolesOf(item, before, deps.now());
    const leftSold = edit.oldValue === "sold" && edited.state !== "sold" ? edited.claimId : null;
    applyItem({ ss, claims: sheet, deps, now: deps.now(), markWrote }, item, previousRoles, readTokens(ss), leftSold);
    return { handled: true, reverted: false };
  });
  return out.busy ? { handled: false, error: "busy" } : out.value;
}
