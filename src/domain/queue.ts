// Queue engine (brief 6.1). Pure: no clock, no platform code. Callers run it
// under the script lock and pass `now` in.

export type ClaimState = "active" | "released" | "sold";
export type ClaimRole = "holder" | "waiting" | "sold" | "ended";

export interface ItemInput {
  id: string;
  quantity: number;
}

export interface ClaimInput {
  claimId: number;
  itemId: string;
  state: ClaimState;
  promotedAt: string | null;
  /** Role before this change (null = created in this write). See D-026. */
  previousRole: ClaimRole | null;
}

export interface ClaimResult {
  claimId: number;
  role: ClaimRole;
  /** 1-based place among waiters, null for everyone else. */
  position: number | null;
  promotedAt: string | null;
  /** True for a waiter on a sold-out item ("This item was sold"). */
  itemSold: boolean;
}

export interface RecalcResult {
  unitsLeft: number;
  freeUnits: number;
  waitingCount: number;
  soldOut: boolean;
  /** Quantity is 0 or not a whole number: nobody can hold or queue (D-026). */
  unavailable: boolean;
  claims: ClaimResult[];
  changes: { promoted: number[]; demoted: number[] };
}

const soldCount = (item: ItemInput, claims: ClaimInput[]): number =>
  claims.filter((c) => c.itemId === item.id && c.state === "sold").length;

const validQuantity = (q: unknown): q is number => Number.isInteger(q) && (q as number) >= 0;

export function recalculate(item: ItemInput, claims: ClaimInput[], now: string): RecalcResult {
  const own = claims.filter((c) => c.itemId === item.id).sort((a, b) => a.claimId - b.claimId);
  const sold = soldCount(item, claims);
  const unavailable = !validQuantity(item.quantity) || item.quantity === 0;
  const unitsLeft = unavailable ? 0 : Math.max(0, item.quantity - sold);
  const soldOut = !unavailable && sold > 0 && unitsLeft === 0;

  const changes: RecalcResult["changes"] = { promoted: [], demoted: [] };
  let active = 0;
  let waitingCount = 0;

  const results = own.map((c): ClaimResult => {
    const base = { claimId: c.claimId, position: null, promotedAt: null, itemSold: false };
    if (c.state === "sold") return { ...base, role: "sold" };
    if (c.state === "released") return { ...base, role: "ended" };

    active += 1;
    if (active <= unitsLeft) {
      if (c.previousRole === "holder") return { ...base, role: "holder", promotedAt: c.promotedAt };
      if (c.previousRole === null) return { ...base, role: "holder" };
      changes.promoted.push(c.claimId);
      return { ...base, role: "holder", promotedAt: now };
    }

    if (c.previousRole === "holder") changes.demoted.push(c.claimId);
    waitingCount += 1;
    return { ...base, role: "waiting", position: waitingCount, itemSold: soldOut };
  });

  return {
    unitsLeft,
    freeUnits: Math.max(0, unitsLeft - active),
    waitingCount,
    soldOut,
    unavailable,
    claims: results,
    changes,
  };
}

export function canMarkSold(
  item: ItemInput,
  claims: ClaimInput[],
  claimId: number,
): { ok: true } | { ok: false; reason: string } {
  const target = claims.find((c) => c.claimId === claimId && c.itemId === item.id);
  if (!target) return { ok: false, reason: "That reservation could not be found for this item." };
  if (target.state !== "active") {
    return { ok: false, reason: `Only an active reservation can be marked sold (this one is ${target.state}).` };
  }
  const sold = soldCount(item, claims);
  if (!validQuantity(item.quantity)) {
    return { ok: false, reason: "This item's quantity isn't a whole number. Fix the Quantity cell first." };
  }
  if (item.quantity === 0) return { ok: false, reason: "This item has no units to sell. Set a quantity first." };
  if (sold >= item.quantity) {
    const units = `${item.quantity} unit${item.quantity === 1 ? " is" : "s are"}`;
    return { ok: false, reason: `All ${units} already sold. Undo another sale first.` };
  }
  return { ok: true };
}
