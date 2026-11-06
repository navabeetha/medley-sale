// S-13 Q2: any accepted State change clears the catalogue cache, even when it leads to no write of ours (waitingCount must not go stale). (docs/backlog/stories/S-13-whatsapp-handoff.md). Synthetic data only; in-memory fake sheet.
import { describe, expect, it } from "vitest";
import { CATALOGUE_CACHE_KEY } from "../../src/api/handle-get";
import { STAMP, build, claimsTab, harness, rowOfClaim, type SeedClaim } from "../fixtures/queue-sheet";

const cacheClears = (events: string[]) => events.filter((e) => e === `cache:${CATALOGUE_CACHE_KEY}`).length;


// ---- Q2

describe("Q2: an accepted State change clears the catalogue cache even when we write nothing", () => {
  // Echo Dot qty 1: claim 1 holds, 2 and 3 wait. Settled first, so a waiter leaving changes nothing we maintain.
  const SEED: SeedClaim[] = [{ id: 1, item: "I-0001", promoted: STAMP }, { id: 2, item: "I-0001" }, { id: 3, item: "I-0001" }];

  // After the settling recalc, the waiter's Message link is cleared by hand, so releasing the waiter leaves nothing for us to write.
  const clearLink = (h: ReturnType<typeof harness>, id: number) => {
    const t = claimsTab(h.ss);
    t.grid[rowOfClaim(h.ss, id) - 1]![t.grid[0]!.indexOf("Message link")] = null;
  };

  it("a waiter marked released with nothing else to write still clears the cache once", () => {
    const h = harness(build(SEED));
    h.recalc();
    clearLink(h, 3);
    h.events.length = 0;
    h.edit(3, "released");
    expect(h.events.filter((e) => e === "write")).toEqual([]); // the premise: nothing of ours was written
    expect(cacheClears(h.events)).toBe(1);
  });
});

