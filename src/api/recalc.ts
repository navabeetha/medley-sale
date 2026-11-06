// S-15: the timed repair, every 10 minutes (brief 2.7, D-039). It recalculates every item and fixes
// whatever the on-edit trigger missed (an edit from the phone app, a paste, a busy lock): Status,
// Person, Message link, blank Sold at / Sold price.
//
// D-039: it does NOT invent promotions. With no edit event there is no "before", so each claim's
// previousRole is its CURRENT role: holders keep their stamp, nobody new is stamped, and a claim that
// is no longer a holder loses its stamp (6.1 rule 3). The cost, accepted in D-039, is that a promotion
// whose edit was missed gets no Promoted at and so no To do row.
import { CLAIMS, locked, repairAll, type SellerDeps } from "./seller-sheet";
import type { Spreadsheet } from "./sheet";

export type RecalcOutcome = { ok: true } | { ok: false; error: "busy" | "not-reserving" };

export function recalculateAll(ss: Spreadsheet, deps: SellerDeps): RecalcOutcome {
  const claimsTab = ss.getTab(CLAIMS);
  if (!claimsTab) return { ok: false, error: "not-reserving" }; // status mode (D-038.6): no lock, nothing to do
  const out = locked(ss, deps, (markWrote) => repairAll(ss, claimsTab, deps, markWrote));
  return out.busy ? { ok: false, error: "busy" } : { ok: true };
}
