import { describe, expect, it } from "vitest";
import { canMarkSold, recalculate } from "../../src/domain/queue";
import type { ClaimInput, ItemInput } from "../../src/domain/queue";

// Interface under test (see the S-02 hand-off report):
//   recalculate(item, claims, now) -> { unitsLeft, freeUnits, waitingCount, soldOut, claims[], changes }
//   canMarkSold(item, claims, claimId) -> { ok: true } | { ok: false, reason }
// D-026: `previousRole` is the role the claim had before this change:
// "holder" | "waiting" | "sold" | "ended" | null, where null means only
// "created in this write". Becoming a holder from anything except "holder" or
// null is a promotion (stamped, listed in changes.promoted). Result also has
// `unavailable` (quantity 0 or not a whole number >= 0): no holders, flag for UI/API.

const NOW = "2026-11-03T10:00:00.000Z";
const EARLIER = "2026-11-02T09:00:00.000Z";
const LATER = "2026-11-04T12:30:00.000Z";

type Role = "holder" | "waiting" | "sold" | "ended" | null;
const item = (quantity: number, id = "item-1"): ItemInput => ({ id, quantity });
const claim = (
  claimId: number,
  state: ClaimInput["state"] = "active",
  previousRole: Role = null,
  promotedAt: string | null = null,
  itemId = "item-1",
): ClaimInput => ({ claimId, itemId, state, promotedAt, previousRole });
// Active claims already in the steady state a prior recalculation would leave.
const settled = (n: number, quantity: number): ClaimInput[] =>
  Array.from({ length: n }, (_, i) => claim(i + 1, "active", i < quantity ? "holder" : "waiting"));

const byId = (r: ReturnType<typeof recalculate>, id: number) => {
  const c = r.claims.find((x) => x.claimId === id);
  if (!c) throw new Error(`no result for claim ${id}`);
  return c;
};
const roles = (r: ReturnType<typeof recalculate>) =>
  Object.fromEntries(r.claims.map((c) => [c.claimId, c.role]));

describe("rules 1 and 2: line order and holders", () => {
  it("makes the first unitsLeft active claims holders and the rest waiting (quantity 3, 5 claims)", () => {
    const r = recalculate(item(3), settled(5, 3), NOW);
    expect(roles(r)).toEqual({ 1: "holder", 2: "holder", 3: "holder", 4: "waiting", 5: "waiting" });
    expect(r.unitsLeft).toBe(3);
    expect(r.waitingCount).toBe(2);
    expect(r.soldOut).toBe(false);
  });

  it("numbers waiters 1-based in line order and gives non-waiters no position", () => {
    const r = recalculate(item(3), settled(5, 3), NOW);
    expect(byId(r, 4).position).toBe(1);
    expect(byId(r, 5).position).toBe(2);
    expect(byId(r, 1).position).toBeNull();
    expect(byId(r, 3).position).toBeNull();
  });

  it("defaults to a single holder at quantity 1", () => {
    const r = recalculate(item(1), settled(3, 1), NOW);
    expect(roles(r)).toEqual({ 1: "holder", 2: "waiting", 3: "waiting" });
    expect(r.unitsLeft).toBe(1);
  });

  it("orders by numeric claim ID, not by input order or string order", () => {
    // String order would put 10 before 9; input order is shuffled too.
    const claims = [claim(10), claim(2), claim(9), claim(1)];
    const r = recalculate(item(2), claims, NOW);
    expect(roles(r)).toEqual({ 1: "holder", 2: "holder", 9: "waiting", 10: "waiting" });
    expect(byId(r, 9).position).toBe(1);
    expect(byId(r, 10).position).toBe(2);
  });

  it("copes with non-contiguous IDs (IDs are never reused)", () => {
    const r = recalculate(item(2), [claim(3), claim(7), claim(40), claim(41)], NOW);
    expect(roles(r)).toEqual({ 3: "holder", 7: "holder", 40: "waiting", 41: "waiting" });
  });

  it("returns an empty, not-sold-out result for an item with no claims", () => {
    const r = recalculate(item(3), [], NOW);
    expect(r.claims).toEqual([]);
    expect(r.unitsLeft).toBe(3);
    expect(r.freeUnits).toBe(3);
    expect(r.waitingCount).toBe(0);
    expect(r.soldOut).toBe(false);
    expect(r.changes).toEqual({ promoted: [], demoted: [] });
  });

  it("reports free units when fewer claims than units exist", () => {
    const r = recalculate(item(4), settled(1, 4), NOW);
    expect(r.freeUnits).toBe(3);
    expect(r.waitingCount).toBe(0);
  });

  it("reports zero free units when every unit is held", () => {
    expect(recalculate(item(2), settled(3, 2), NOW).freeUnits).toBe(0);
  });

  it("ignores claims that belong to another item", () => {
    const claims = [claim(1), claim(2, "sold", null, null, "item-2"), claim(3, "active", null, null, "item-2"), claim(4)];
    const r = recalculate(item(2), claims, NOW);
    expect(r.claims.map((c) => c.claimId).sort()).toEqual([1, 4]);
    expect(r.unitsLeft).toBe(2);
    expect(roles(r)).toEqual({ 1: "holder", 4: "holder" });
  });

  it("gives nobody a hold when quantity is 0", () => {
    const r = recalculate(item(0), [claim(1), claim(2)], NOW);
    expect(r.unitsLeft).toBe(0);
    expect(Object.values(roles(r))).not.toContain("holder");
    expect(r.changes.promoted).toEqual([]);
  });

  it("is available (not unavailable) for ordinary quantities, including a sold-out item", () => {
    expect(recalculate(item(3), settled(2, 3), NOW).unavailable).toBe(false);
    expect(recalculate(item(1), [claim(1, "sold", "holder"), claim(2, "active", "waiting")], NOW).unavailable).toBe(false);
    expect(recalculate(item(1), [], NOW).unavailable).toBe(false);
  });

  it("never reports negative unitsLeft or free units when sold claims exceed quantity (bad sheet data)", () => {
    const r = recalculate(item(1), [claim(1, "sold"), claim(2, "sold"), claim(3)], NOW);
    expect(r.unitsLeft).toBe(0);
    expect(r.freeUnits).toBe(0);
    expect(roles(r)[3]).toBe("waiting");
  });

  it("copes with a single claim", () => {
    const r = recalculate(item(1), [claim(5)], NOW);
    expect(roles(r)).toEqual({ 5: "holder" });
  });
});

describe("claim states: released and sold", () => {
  it("gives released claims the 'ended' role, no position, and no place in line", () => {
    const r = recalculate(item(1), [claim(1, "released", "holder"), claim(2, "active", "waiting")], NOW);
    expect(byId(r, 1).role).toBe("ended");
    expect(byId(r, 1).position).toBeNull();
    expect(byId(r, 2).role).toBe("holder");
  });

  it("gives sold claims the 'sold' role and counts them out of unitsLeft", () => {
    const r = recalculate(item(3), [claim(1, "sold"), ...settled(5, 3).slice(1)], NOW);
    expect(byId(r, 1).role).toBe("sold");
    expect(r.unitsLeft).toBe(2);
  });

  it("does not let released claims count against unitsLeft", () => {
    const r = recalculate(item(2), [claim(1, "released"), claim(2, "released"), claim(3)], NOW);
    expect(r.unitsLeft).toBe(2);
  });
});

describe("rule 3: promotion stamping and clearing", () => {
  it("T-02: quantity 3, 5 claims, second holder backs out: fourth becomes holder (stamped), fifth stays waiting", () => {
    const claims = settled(5, 3);
    claims[1] = claim(2, "released", "holder");
    const r = recalculate(item(3), claims, NOW);
    expect(roles(r)).toEqual({ 1: "holder", 2: "ended", 3: "holder", 4: "holder", 5: "waiting" });
    expect(byId(r, 4).promotedAt).toBe(NOW);
    expect(byId(r, 5).promotedAt).toBeNull();
    expect(byId(r, 5).position).toBe(1);
    expect(r.changes).toEqual({ promoted: [4], demoted: [] });
    expect(r.waitingCount).toBe(1);
  });

  it("stamps several promotions at once and lists them in line order", () => {
    const claims = [claim(1, "released", "holder"), claim(2, "released", "holder"), ...settled(5, 2).slice(2).map((c) => claim(c.claimId, "active", "waiting"))];
    const r = recalculate(item(2), claims, NOW);
    expect(r.changes.promoted).toEqual([3, 4]);
    expect(byId(r, 3).promotedAt).toBe(NOW);
    expect(byId(r, 4).promotedAt).toBe(NOW);
    expect(byId(r, 5).promotedAt).toBeNull();
  });

  it("keeps the existing promotedAt of a claim that is still a holder", () => {
    const claims = [claim(1, "active", "holder"), claim(2, "active", "holder", EARLIER), claim(3, "active", "waiting")];
    const r = recalculate(item(2), claims, LATER);
    expect(byId(r, 2).promotedAt).toBe(EARLIER);
    expect(r.changes).toEqual({ promoted: [], demoted: [] });
  });

  it("clears promotedAt on a holder who is demoted to waiting, and reports the demotion", () => {
    // Seller sells waiting claim 4 while 1-3 hold (qty 3 -> 2 left): claim 3 is pushed out.
    const claims = [claim(1, "active", "holder"), claim(2, "active", "holder"), claim(3, "active", "holder", EARLIER), claim(4, "sold", "waiting")];
    const r = recalculate(item(3), claims, NOW);
    expect(roles(r)).toEqual({ 1: "holder", 2: "holder", 3: "waiting", 4: "sold" });
    expect(byId(r, 3).promotedAt).toBeNull();
    expect(r.changes).toEqual({ promoted: [], demoted: [3] });
  });

  it("clears promotedAt on claims that are no longer active", () => {
    const r = recalculate(item(2), [claim(1, "released", "holder", EARLIER), claim(2, "sold", "holder", EARLIER), claim(3)], NOW);
    expect(byId(r, 1).promotedAt).toBeNull();
    expect(byId(r, 2).promotedAt).toBeNull();
  });

  it("does not report a released or sold holder as demoted", () => {
    const r = recalculate(item(1), [claim(1, "released", "holder"), claim(2, "active", "waiting")], NOW);
    expect(r.changes.demoted).toEqual([]);
  });

  it("does not stamp claims that are holders from the moment they are created (proposed decision)", () => {
    const r = recalculate(item(2), [claim(1, "active", "holder"), claim(2, "active", null)], NOW);
    expect(byId(r, 2).role).toBe("holder");
    expect(byId(r, 2).promotedAt).toBeNull();
    expect(r.changes.promoted).toEqual([]);
  });

  it("does not stamp a waiting claim that stays waiting", () => {
    const r = recalculate(item(1), settled(3, 1), NOW);
    expect(byId(r, 2).promotedAt).toBeNull();
    expect(byId(r, 3).promotedAt).toBeNull();
  });

  it("stamps with exactly the injected now", () => {
    const claims = [claim(1, "released", "holder"), claim(2, "active", "waiting")];
    expect(byId(recalculate(item(1), claims, NOW), 2).promotedAt).toBe(NOW);
    expect(byId(recalculate(item(1), claims, LATER), 2).promotedAt).toBe(LATER);
  });
});

describe("one unit sold", () => {
  it("quantity 3, 5 claims, first claim sold: unitsLeft 2, claims 2 and 3 hold, nobody is promoted", () => {
    const claims = settled(5, 3);
    claims[0] = claim(1, "sold", "holder");
    const r = recalculate(item(3), claims, NOW);
    expect(r.unitsLeft).toBe(2);
    expect(roles(r)).toEqual({ 1: "sold", 2: "holder", 3: "holder", 4: "waiting", 5: "waiting" });
    expect(r.changes).toEqual({ promoted: [], demoted: [] });
    expect(r.soldOut).toBe(false);
  });

  it("seller marks a waiting claim sold: allowed, shrinks unitsLeft, and the last holder is pushed out", () => {
    const claims = settled(3, 2);
    claims[2] = claim(3, "sold", "waiting");
    const r = recalculate(item(2), claims, NOW);
    expect(r.unitsLeft).toBe(1);
    expect(roles(r)).toEqual({ 1: "holder", 2: "waiting", 3: "sold" });
    expect(r.changes.demoted).toEqual([2]);
  });
});

describe("rule 4 and T-06: undoing a sale or a release returns the original place", () => {
  it("undoing a sale: the claim is a holder again in its original place", () => {
    const sold = [claim(1, "sold", "holder"), claim(2, "active", "waiting"), claim(3, "active", "waiting")];
    const before = recalculate(item(2), sold, NOW);
    expect(roles(before)).toEqual({ 1: "sold", 2: "holder", 3: "waiting" });

    // D-026 section 1: the restored claim comes in as "sold", not null.
    const undone = [claim(1, "active", "sold"), claim(2, "active", "holder", NOW), claim(3, "active", "waiting")];
    const r = recalculate(item(2), undone, LATER);
    expect(roles(r)).toEqual({ 1: "holder", 2: "holder", 3: "waiting" });
    expect(r.unitsLeft).toBe(2);
    expect(byId(r, 1).promotedAt).toBe(LATER);
    expect(byId(r, 2).promotedAt).toBe(NOW);
    expect(r.changes).toEqual({ promoted: [1], demoted: [] });
  });

  it("T-06 (undo a sale, quantity 1): the sold-out waiter is demoted again and its promotedAt cleared", () => {
    // Sale undone while claim 2 had been promoted into the freed unit.
    // Restored claim 1 was "sold" (D-026). It is promoted (accepted cost); claim 2 is demoted.
    const claims = [claim(1, "active", "sold"), claim(2, "active", "holder", EARLIER)];
    const r = recalculate(item(1), claims, NOW);
    expect(roles(r)).toEqual({ 1: "holder", 2: "waiting" });
    expect(byId(r, 2).promotedAt).toBeNull();
    expect(byId(r, 1).promotedAt).toBe(NOW);
    expect(r.changes).toEqual({ promoted: [1], demoted: [2] });
    expect(byId(r, 2).position).toBe(1);
  });

  it("T-06 (undo a release after a promotion): original claim regains its place and is promoted (accepted cost), the other claim is demoted with promotedAt cleared", () => {
    const released = recalculate(item(1), [claim(1, "released", "holder"), claim(2, "active", "waiting")], EARLIER);
    expect(byId(released, 2).role).toBe("holder");
    expect(byId(released, 2).promotedAt).toBe(EARLIER);

    // Seller changes claim 1 back to active; feed back what was persisted.
    const r = recalculate(item(1), [claim(1, "active", "ended"), claim(2, "active", "holder", byId(released, 2).promotedAt)], NOW);
    expect(roles(r)).toEqual({ 1: "holder", 2: "waiting" });
    expect(byId(r, 2).promotedAt).toBeNull();
    expect(byId(r, 1).promotedAt).toBe(NOW);
    expect(r.changes.demoted).toEqual([2]);
    expect(r.changes.promoted).toEqual([1]);
  });

  it("T-06 undo of a sale (previousRole 'sold') and of a release ('ended') both promote the original holder who regains a unit", () => {
    for (const prev of ["sold", "ended"] as const) {
      const r = recalculate(item(1), [claim(1, "active", prev), claim(2, "active", "holder", EARLIER)], NOW);
      expect(r.changes).toEqual({ promoted: [1], demoted: [2] });
      expect(byId(r, 1).promotedAt).toBe(NOW);
      expect(byId(r, 2).promotedAt).toBeNull();
    }
  });

  it("undoing a release restores the claim even when it was formerly waiting and unitsLeft covers it (promoted, D-026)", () => {
    const r = recalculate(item(3), [claim(1, "active", "holder"), claim(2, "active", "ended"), claim(3, "active", "holder"), claim(4, "active", "waiting")], NOW);
    expect(roles(r)).toEqual({ 1: "holder", 2: "holder", 3: "holder", 4: "waiting" });
    expect(r.changes.promoted).toEqual([2]);
    expect(byId(r, 2).promotedAt).toBe(NOW);
  });
});

describe("rule 5 and T-04: backing out and returning joins the end", () => {
  it("T-04: a person who backed out and reserves again gets a new, higher claim ID and waits behind existing claims", () => {
    // Claim 1 backed out (released); later claims 2 holds; the same person returns as claim 4.
    const claims = [claim(1, "released", "holder"), claim(2, "active", "holder"), claim(3, "active", "waiting"), claim(4, "active", null)];
    const r = recalculate(item(1), claims, NOW);
    expect(roles(r)).toEqual({ 1: "ended", 2: "holder", 3: "waiting", 4: "waiting" });
    expect(byId(r, 4).position).toBe(2);
    expect(byId(r, 1).position).toBeNull();
  });

  it("the returning claim becomes a holder only if free units exist, and is not stamped as promoted", () => {
    const r = recalculate(item(2), [claim(1, "released", "holder"), claim(2, "active", "holder"), claim(3, "active", null)], NOW);
    expect(byId(r, 3).role).toBe("holder");
    expect(byId(r, 3).promotedAt).toBeNull();
  });
});

describe("T-03: buyer picks 3 with 2 free", () => {
  it("quantity 2, empty item, three new claims: 2 hold, 1 waits, nobody is promoted", () => {
    const r = recalculate(item(2), [claim(1), claim(2), claim(3)], NOW);
    expect(roles(r)).toEqual({ 1: "holder", 2: "holder", 3: "waiting" });
    expect(byId(r, 3).position).toBe(1);
    expect(r.waitingCount).toBe(1);
    expect(r.changes.promoted).toEqual([]);
  });

  it("quantity 3 with one existing holder, three new claims: 3 hold in total, the last new claim waits", () => {
    const r = recalculate(item(3), [claim(1, "active", "holder"), claim(2), claim(3), claim(4)], NOW);
    expect(roles(r)).toEqual({ 1: "holder", 2: "holder", 3: "holder", 4: "waiting" });
  });
});

describe("rule 8: sold out", () => {
  it("flags soldOut when sold claims use every unit, and keeps waiters active and marked 'item sold'", () => {
    const r = recalculate(item(1), [claim(1, "sold", "holder"), claim(2, "active", "waiting"), claim(3, "active", "waiting")], NOW);
    expect(r.soldOut).toBe(true);
    expect(r.unitsLeft).toBe(0);
    expect(r.waitingCount).toBe(2);
    expect(roles(r)).toEqual({ 1: "sold", 2: "waiting", 3: "waiting" });
    expect(byId(r, 2).itemSold).toBe(true);
    expect(byId(r, 3).itemSold).toBe(true);
    expect(byId(r, 2).position).toBe(1);
  });

  it("does not mark waiters 'item sold' while units remain, even when everything is held", () => {
    const r = recalculate(item(1), settled(2, 1), NOW);
    expect(r.soldOut).toBe(false);
    expect(byId(r, 2).itemSold).toBe(false);
    expect(byId(r, 1).itemSold).toBe(false);
  });

  it("never promotes a waiter when the item is sold out", () => {
    const r = recalculate(item(2), [claim(1, "sold", "holder"), claim(2, "sold", "holder"), claim(3, "active", "waiting")], NOW);
    expect(byId(r, 3).promotedAt).toBeNull();
    expect(r.changes.promoted).toEqual([]);
  });

  it("is not sold out when the only sold claims belong to another item", () => {
    const r = recalculate(item(1), [claim(1, "sold", null, null, "item-2"), claim(2)], NOW);
    expect(r.soldOut).toBe(false);
  });
});

describe("D-026 section 1: promotion is any change into holder from a previous role other than holder or null", () => {
  it("F1 repro: quantity 2, claims 1 and 2 released, claim 3 restored from sold, claim 4 waiting: 3 and 4 are both promoted and stamped", () => {
    const claims = [claim(1, "released", "holder"), claim(2, "released", "holder"), claim(3, "active", "sold"), claim(4, "active", "waiting")];
    const r = recalculate(item(2), claims, NOW);
    expect(roles(r)).toEqual({ 1: "ended", 2: "ended", 3: "holder", 4: "holder" });
    expect(byId(r, 3).promotedAt).toBe(NOW);
    expect(byId(r, 4).promotedAt).toBe(NOW);
    expect(r.changes.promoted).toEqual([3, 4]);
  });

  it("promotes a claim restored from 'ended' that lands as a holder", () => {
    const r = recalculate(item(1), [claim(1, "active", "ended")], NOW);
    expect(byId(r, 1).role).toBe("holder");
    expect(byId(r, 1).promotedAt).toBe(NOW);
    expect(r.changes).toEqual({ promoted: [1], demoted: [] });
  });

  it("does not promote or stamp a restored claim that lands as a waiter", () => {
    for (const prev of ["sold", "ended"] as const) {
      const r = recalculate(item(1), [claim(1, "active", "holder"), claim(2, "active", prev, EARLIER)], NOW);
      expect(byId(r, 2).role).toBe("waiting");
      expect(byId(r, 2).position).toBe(1);
      expect(byId(r, 2).promotedAt).toBeNull();
      expect(r.changes).toEqual({ promoted: [], demoted: [] });
    }
  });

  it("does not promote a claim whose previousRole is 'holder' (still holding)", () => {
    const r = recalculate(item(1), [claim(1, "active", "holder", EARLIER)], NOW);
    expect(r.changes.promoted).toEqual([]);
  });

  it("does not stamp a new claim (previousRole null) that holds, and keeps new claims in line order behind promoted ones", () => {
    const r = recalculate(item(2), [claim(1, "active", "ended"), claim(2, "active", null)], NOW);
    expect(r.changes.promoted).toEqual([1]);
    expect(byId(r, 2).role).toBe("holder");
    expect(byId(r, 2).promotedAt).toBeNull();
  });
});

describe("F6: promotedAt comes from the role transition, never from stale input", () => {
  it("a holder whose previousRole is 'holder' keeps its incoming promotedAt", () => {
    const r = recalculate(item(1), [claim(1, "active", "holder", EARLIER)], LATER);
    expect(byId(r, 1).promotedAt).toBe(EARLIER);
  });

  it("a claim becoming holder from 'waiting' gets exactly now, even if the input carried a stale promotedAt", () => {
    const r = recalculate(item(1), [claim(1, "active", "waiting", EARLIER)], NOW);
    expect(byId(r, 1).promotedAt).toBe(NOW);
  });

  it("a claim becoming holder from 'sold' or 'ended' gets exactly now, even with a stale promotedAt", () => {
    for (const prev of ["sold", "ended"] as const) {
      const r = recalculate(item(1), [claim(1, "active", prev, EARLIER)], NOW);
      expect(byId(r, 1).promotedAt).toBe(NOW);
    }
  });

  it("a new claim (previousRole null) that holds gets null even if the input carried a stale promotedAt", () => {
    const r = recalculate(item(1), [claim(1, "active", null, EARLIER)], NOW);
    expect(byId(r, 1).role).toBe("holder");
    expect(byId(r, 1).promotedAt).toBeNull();
    expect(r.changes.promoted).toEqual([]);
  });
});

describe("F5 and D-026 section 3: quantity 0 is unavailable, not sold out", () => {
  // Design choice: claims on an unavailable item keep role 'waiting' with
  // positions (itemSold false), so the data is kept and restoring the quantity
  // restores the line. The `unavailable` flag tells the UI/API to hide the item.
  it("quantity 0 with nothing sold: unavailable true, soldOut false, no units, no holders", () => {
    const r = recalculate(item(0), [claim(1), claim(2)], NOW);
    expect(r.unavailable).toBe(true);
    expect(r.soldOut).toBe(false);
    expect(r.unitsLeft).toBe(0);
    expect(r.freeUnits).toBe(0);
    expect(Object.values(roles(r))).not.toContain("holder");
  });

  it("quantity 0: claims keep role 'waiting' with 1-based positions and are not marked 'item sold'", () => {
    const r = recalculate(item(0), [claim(1), claim(2)], NOW);
    expect(roles(r)).toEqual({ 1: "waiting", 2: "waiting" });
    expect(byId(r, 1).position).toBe(1);
    expect(byId(r, 2).position).toBe(2);
    expect(byId(r, 1).itemSold).toBe(false);
    expect(r.waitingCount).toBe(2);
  });

  it("quantity 0 with no claims is unavailable and not sold out", () => {
    const r = recalculate(item(0), [], NOW);
    expect(r.unavailable).toBe(true);
    expect(r.soldOut).toBe(false);
  });

  it("setting quantity to 0 demotes former holders and clears their promotedAt", () => {
    const r = recalculate(item(0), [claim(1, "active", "holder", EARLIER)], NOW);
    expect(byId(r, 1).role).toBe("waiting");
    expect(byId(r, 1).promotedAt).toBeNull();
    expect(r.changes).toEqual({ promoted: [], demoted: [1] });
  });

  it("restoring the quantity from 0 promotes the first waiter(s) so the line comes back", () => {
    const r = recalculate(item(1), [claim(1, "active", "waiting"), claim(2, "active", "waiting")], NOW);
    expect(r.unavailable).toBe(false);
    expect(r.changes.promoted).toEqual([1]);
  });

  it("soldOut is true only when at least one unit is sold and none are left", () => {
    expect(recalculate(item(1), [claim(1, "sold", "holder")], NOW).soldOut).toBe(true);
    expect(recalculate(item(1), [claim(1)], NOW).soldOut).toBe(false);
    expect(recalculate(item(0), [], NOW).soldOut).toBe(false);
  });
});

describe("F2: invalid quantities are unavailable and nobody gets a hold", () => {
  const bad: Array<[string, unknown]> = [
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["-1", -1],
    ["2.5", 2.5],
    ["a numeric string", "3"],
    ["undefined", undefined],
    ["null", null],
  ];
  const badItem = (q: unknown): ItemInput => ({ id: "item-1", quantity: q as number });

  for (const [label, q] of bad) {
    it(`recalculate: quantity ${label} gives unavailable true, unitsLeft 0, freeUnits 0 and no holders`, () => {
      const r = recalculate(badItem(q), [claim(1), claim(2, "active", "holder", EARLIER)], NOW);
      expect(r.unavailable).toBe(true);
      expect(r.unitsLeft).toBe(0);
      expect(r.freeUnits).toBe(0);
      expect(Object.values(roles(r))).not.toContain("holder");
      expect(r.changes.promoted).toEqual([]);
      expect(byId(r, 2).promotedAt).toBeNull();
    });

    it(`canMarkSold: quantity ${label} is refused with a plain reason`, () => {
      const res = canMarkSold(badItem(q), [claim(1)], 1);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason.trim().length).toBeGreaterThan(0);
        expect(res.reason).not.toMatch(/NaN|undefined|Infinity/);
      }
    });
  }

  it("canMarkSold: a valid whole-number quantity is still accepted", () => {
    expect(canMarkSold(item(1), [claim(1)], 1)).toEqual({ ok: true });
  });
});

describe("rule 6: pure, deterministic and idempotent (the lock is the caller's job)", () => {
  const scenario = () => [claim(1, "released", "holder"), claim(2, "active", "holder"), claim(3, "active", "waiting"), claim(4, "active", "waiting")];

  it("returns equal output for equal input", () => {
    expect(recalculate(item(2), scenario(), NOW)).toEqual(recalculate(item(2), scenario(), NOW));
  });

  it("does not mutate its inputs", () => {
    const it0 = item(2);
    const cl = scenario();
    const itSnap = structuredClone(it0);
    const clSnap = structuredClone(cl);
    recalculate(it0, cl, NOW);
    expect(it0).toEqual(itSnap);
    expect(cl).toEqual(clSnap);
  });

  it("gives the same roles whatever the input order", () => {
    const a = recalculate(item(2), scenario(), NOW);
    const b = recalculate(item(2), [...scenario()].reverse(), NOW);
    expect(roles(b)).toEqual(roles(a));
    expect(b.changes).toEqual(a.changes);
    expect(b.unitsLeft).toBe(a.unitsLeft);
  });

  it("applying the result and recalculating again changes nothing and does not promote twice", () => {
    const first = recalculate(item(2), scenario(), NOW);
    expect(first.changes.promoted).toEqual([3]);
    // Persist: role -> previousRole (D-026 section 2), promotedAt as returned, state unchanged.
    const persisted = scenario().map((c) => {
      const out = byId(first, c.claimId);
      return { ...c, previousRole: out.role, promotedAt: out.promotedAt };
    });
    const second = recalculate(item(2), persisted, LATER);
    expect(second.changes).toEqual({ promoted: [], demoted: [] });
    expect(second.claims.map((c) => c.promotedAt)).toEqual(first.claims.map((c) => c.promotedAt));
    expect(byId(second, 3).promotedAt).toBe(NOW);
  });

  it("does not depend on the real clock", () => {
    const claims = [claim(1, "released", "holder"), claim(2, "active", "waiting")];
    expect(byId(recalculate(item(1), claims, "2001-01-01T00:00:00.000Z"), 2).promotedAt).toBe("2001-01-01T00:00:00.000Z");
  });
});

describe("rule 7 and T-07: seller marks sold over quantity", () => {
  it("allows marking an active holder sold when units remain", () => {
    expect(canMarkSold(item(3), settled(5, 3), 2)).toEqual({ ok: true });
  });

  it("allows marking a waiting claim sold when it stays within quantity", () => {
    expect(canMarkSold(item(2), settled(3, 2), 3)).toEqual({ ok: true });
  });

  it("allows the last unit to be sold (sold count reaches quantity exactly)", () => {
    expect(canMarkSold(item(2), [claim(1, "sold"), claim(2), claim(3)], 2)).toEqual({ ok: true });
  });

  it("T-07: rejects a sale that would exceed quantity, with a human-readable reason", () => {
    const res = canMarkSold(item(1), [claim(1, "sold"), claim(2, "active", "waiting")], 2);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason.trim().length).toBeGreaterThan(0);
  });

  it("rejects the sale of a unit beyond quantity when several are already sold", () => {
    const res = canMarkSold(item(3), [claim(1, "sold"), claim(2, "sold"), claim(3, "sold"), claim(4)], 4);
    expect(res.ok).toBe(false);
  });

  it("counts only this item's sold claims", () => {
    const claims = [claim(1, "sold", null, null, "item-2"), claim(2)];
    expect(canMarkSold(item(1), claims, 2)).toEqual({ ok: true });
  });

  it("does not count released claims as sold", () => {
    expect(canMarkSold(item(1), [claim(1, "released"), claim(2)], 2)).toEqual({ ok: true });
  });

  it("rejects quantity 0 (nothing can be sold)", () => {
    expect(canMarkSold(item(0), [claim(1)], 1).ok).toBe(false);
  });

  it("rejects an unknown claim ID or a claim that is not active, with a reason", () => {
    const claims = [claim(1, "released"), claim(2, "sold")];
    for (const id of [1, 2, 99]) {
      const res = canMarkSold(item(5), claims, id);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason.length).toBeGreaterThan(0);
    }
  });

  it("does not mutate its inputs", () => {
    const cl = settled(3, 2);
    const snap = structuredClone(cl);
    canMarkSold(item(2), cl, 3);
    expect(cl).toEqual(snap);
  });
});
