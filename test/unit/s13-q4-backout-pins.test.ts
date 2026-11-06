// S-13 Q4: backOut pins markWrote before the State write (M5); queue.ts exports the refusal wording and isOurStateNote uses it (M23); malformed requests take no lock.
// DESIGNED INTERFACE: queue.ts exports `isRefusalReason(note: string): boolean`, true for every reason canMarkSold can give. It is read
// through a namespace import so this file type-checks before the export exists. (docs/backlog/stories/S-13-whatsapp-handoff.md). Synthetic data only; in-memory fake sheet.
import { describe, expect, it } from "vitest";
import { backOut } from "../../src/api/back-out";
import { CATALOGUE_CACHE_KEY } from "../../src/api/handle-get";
import { isOurStateNote } from "../../src/api/seller-sheet";
import * as queue from "../../src/domain/queue";
import type { FakeTab } from "../fixtures/fake-sheet";
import { STAMP, build, harness, tokenOf, type SeedClaim } from "../fixtures/queue-sheet";

const SELLER_NOTE = "Hers: Dev said he will collect Friday"; // the seller's own words, synthetic
const cacheClears = (events: string[]) => events.filter((e) => e === `cache:${CATALOGUE_CACHE_KEY}`).length;


// ---- Q4

describe("Q4a: backOut marks the write before the State write (mutant M5)", () => {
  const LINE: SeedClaim[] = [{ id: 1, item: "I-0001", promoted: STAMP }, { id: 2, item: "I-0001" }];

  it("when the State write itself throws, the lock is still flushed, the cache cleared and the lock released", () => {
    const h = harness(build(LINE));
    (h.ss.getTab("Claims") as FakeTab).setCell = () => { throw new Error("quota"); };
    expect(() => backOut(h.ss, { token: tokenOf(1), claimId: 1 }, h.deps as never)).toThrow();
    expect(h.events).toContain("flush");
    expect(cacheClears(h.events)).toBe(1);
    expect(h.events.filter((e) => e === "releaseLock")).toHaveLength(1);
  });
});

describe("Q4b: the refusal wording lives in queue.ts and isOurStateNote uses it (mutant M23)", () => {
  const isRefusalReason = (queue as unknown as Record<string, unknown>)["isRefusalReason"] as (s: string) => boolean;
  const item = { id: "I-1", quantity: 2 };
  const c = (claimId: number, state: queue.ClaimState): queue.ClaimInput => ({ claimId, itemId: "I-1", state, promotedAt: null, previousRole: null });
  const reasons = (): string[] => {
    const refuse = (i: queue.ItemInput, claims: queue.ClaimInput[], id: number) => {
      const r = queue.canMarkSold(i, claims, id);
      return r.ok ? "" : r.reason;
    };
    return [
      refuse(item, [], 9), // not found
      refuse(item, [c(1, "released")], 1), // not active
      refuse({ id: "I-1", quantity: 1.5 }, [c(1, "active")], 1), // quantity not whole
      refuse({ id: "I-1", quantity: 0 }, [c(1, "active")], 1), // no units
      refuse({ id: "I-1", quantity: 1 }, [c(1, "sold"), c(2, "active")], 2), // all sold, singular
      refuse(item, [c(1, "sold"), c(2, "sold"), c(3, "active")], 3), // all sold, plural
    ];
  };

  it("queue.ts exports isRefusalReason", () => {
    expect(typeof isRefusalReason).toBe("function");
  });

  it("every reason canMarkSold can give is recognised as a refusal reason and as our State note", () => {
    for (const r of reasons()) {
      expect(r).not.toBe("");
      expect(isRefusalReason(r)).toBe(true);
      expect(isOurStateNote(r)).toBe(true);
    }
  });

  it("the seller's own words, and near misses, are not refusal reasons", () => {
    for (const s of [SELLER_NOTE, "", "All 2 units are already sold.", "Only an active reservation can be marked sold (this one is)."]) {
      expect(isRefusalReason(s)).toBe(false);
    }
  });
});

describe("Q4c: malformed backOut requests answer without taking the lock", () => {
  const LINE: SeedClaim[] = [{ id: 1, item: "I-0001", promoted: STAMP }];
  const bad: [string, unknown][] = [
    ["a non-object", "x"], ["null", null], ["an array", []], ["a missing token", { claimId: 1 }], ["a numeric token", { token: 5, claimId: 1 }],
    ["a missing claimId", { token: tokenOf(1) }], ["a string claimId", { token: tokenOf(1), claimId: "1" }],
    ["a fractional claimId", { token: tokenOf(1), claimId: 1.5 }], ["a zero claimId", { token: tokenOf(1), claimId: 0 }],
    ["a negative claimId", { token: tokenOf(1), claimId: -1 }], ["a NaN claimId", { token: tokenOf(1), claimId: NaN }],
  ];
  it.each(bad)("%s: not-found, no lock, no read, no write", (_l, request) => {
    const h = harness(build(LINE));
    h.events.length = 0;
    expect(backOut(h.ss, request, h.deps as never)).toEqual({ ok: false, error: "not-found" });
    expect(h.events).toEqual([]);
  });
});
