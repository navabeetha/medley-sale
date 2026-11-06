// S-13: POST {action:"waOpened", token} records that the buyer's browser went to WhatsApp (brief 4.3, "Records `WhatsApp opened`
// where possible"). Best effort: it never blocks or changes the reservation. Synthetic data only, in-memory fake sheet.
//
// DESIGNED INTERFACE:
//   handlePost: PostDeps gains   waOpened: (request: unknown) => unknown   routed on the exact action "waOpened"
//     (same rules as the other actions: exact match, parsed body object, a throw answers {"error":"unavailable"}).
//   src/api/wa-opened.ts:  waOpened(ss: Spreadsheet, request: unknown, deps: SellerDeps): WaOpenedResponse
//     Request { token: string }.
//     { ok: true }                      the Bookings row's "WhatsApp opened" cell now holds the first time it was opened
//                                       (deps.now()); a repeat leaves the first time as it was and writes nothing. A sheet with no
//                                       "WhatsApp opened" column still answers ok and writes nothing ("where possible").
//     { ok: false, error: "not-found" } a missing, non-string, empty or unknown token, byte for byte the same for each (T-11);
//                                       answered before any lock or read when the token is not even a string.
//     { ok: false, error: "not-reserving" } no Bookings tab (status mode, D-038.6); no lock.
//     { ok: false, error: "busy" }      the lock could not be taken; nothing written.
//     Takes the script lock, flushes after its write, releases once. It writes only that one cell: no claim, item, other booking
//     or note changes. It answers no name, number, row number or other buyer's data.
//   The module is loaded with a dynamic import so this file type-checks before it exists.
import { describe, expect, it } from "vitest";
import { handlePost, type PostDeps } from "../../src/api/handle-post";
import { CATALOGUE_CACHE_KEY } from "../../src/api/handle-get";
import { NOW, STAMP, build, harness, tokenOf } from "../fixtures/queue-sheet";
import type { FakeTab } from "../fixtures/fake-sheet";

type Res = { ok: boolean; error?: string };
const run = async (ss: unknown, request: unknown, deps: unknown): Promise<Res> => {
  const modPath = new URL("../../src/api/wa-opened.ts", import.meta.url).pathname;
  const mod = (await import(/* @vite-ignore */ modPath)) as { waOpened: (s: unknown, r: unknown, d: unknown) => Res };
  return mod.waOpened(ss, request, deps);
};
const SEED = [{ id: 1, item: "I-0001", promoted: STAMP }, { id: 2, item: "I-0001" }];
const openedOf = (h: ReturnType<typeof harness>, booking: number) => {
  const t = h.ss.getTab("Bookings") as FakeTab;
  const col = t.grid[0]!.indexOf("WhatsApp opened");
  return t.grid.find((r, i) => i > 0 && r[0] === booking)![col];
};

describe("handlePost routes waOpened", () => {
  const deps = (over: Partial<PostDeps> = {}): PostDeps => ({ reserve: () => ({}), booking: () => ({}), backOut: () => ({}), waOpened: () => ({ ok: true }), ...over } as PostDeps);
  it("hands the parsed body to deps.waOpened and returns its answer as JSON", () => {
    let seen: unknown;
    const out = handlePost(JSON.stringify({ action: "waOpened", token: "abc" }), deps({ waOpened: (r: unknown) => { seen = r; return { ok: true }; } } as never));
    expect(seen).toEqual({ action: "waOpened", token: "abc" });
    expect(JSON.parse(out)).toEqual({ ok: true });
  });
  it("answers the generic 'unavailable' if the handler throws, and does not match a near-miss action", () => {
    expect(JSON.parse(handlePost(JSON.stringify({ action: "waOpened" }), deps({ waOpened: () => { throw new Error("name Asha"); } } as never)))).toEqual({ error: "unavailable" });
    for (const a of ["waopened", "WaOpened", " waOpened"]) expect(JSON.parse(handlePost(JSON.stringify({ action: a }), deps()))).toEqual({ error: "unknown action" });
  });
});

describe("waOpened records the handoff on the Bookings row", () => {
  it("stamps the buyer's own booking with the time, and no other booking", async () => {
    const h = harness(build(SEED));
    expect(await run(h.ss, { token: tokenOf(1) }, h.deps)).toEqual({ ok: true });
    expect(openedOf(h, 1)).toBe(NOW);
    expect(openedOf(h, 2) ?? null).toBeNull();
  });

  it("writes exactly one cell: the rest of the sheet is untouched", async () => {
    const h = harness(build(SEED));
    const before = JSON.parse(h.ss.snapshot());
    await run(h.ss, { token: tokenOf(1) }, h.deps);
    const after = JSON.parse(h.ss.snapshot());
    const col = (before.tabs.find((t: { name: string }) => t.name === "Bookings").grid[0] as unknown[]).indexOf("WhatsApp opened");
    after.tabs.find((t: { name: string }) => t.name === "Bookings").grid[0 + 1][col] = before.tabs.find((t: { name: string }) => t.name === "Bookings").grid[1][col];
    expect(after).toEqual(before);
  });

  it("a repeat keeps the first time and writes nothing", async () => {
    const h = harness(build(SEED));
    await run(h.ss, { token: tokenOf(1) }, h.deps);
    const snap = h.ss.snapshot();
    expect(await run(h.ss, { token: tokenOf(1) }, { ...h.deps, now: () => "2027-01-01T00:00:00.000Z" })).toEqual({ ok: true });
    expect(h.ss.snapshot()).toBe(snap);
  });

  it("takes the lock before reading, flushes after the write, and releases once", async () => {
    const h = harness(build(SEED));
    await run(h.ss, { token: tokenOf(1) }, h.deps);
    const e = h.events;
    expect(e.indexOf("waitLock")).toBe(0);
    expect(e.indexOf("flush")).toBeGreaterThan(e.lastIndexOf("write"));
    expect(e.filter((x) => x === "releaseLock")).toHaveLength(1);
  });

  it("answers ok and writes nothing on a sheet with no 'WhatsApp opened' column", async () => {
    const h = harness(build(SEED));
    const t = h.ss.getTab("Bookings") as FakeTab;
    const col = t.grid[0]!.indexOf("WhatsApp opened");
    t.grid = t.grid.map((r) => r.filter((_, i) => i !== col));
    const snap = h.ss.snapshot();
    expect(await run(h.ss, { token: tokenOf(1) }, h.deps)).toEqual({ ok: true });
    expect(h.ss.snapshot()).toBe(snap);
  });

  it("answers busy, writing nothing, when the lock cannot be taken", async () => {
    const h = harness(build(SEED));
    const snap = h.ss.snapshot();
    expect(await run(h.ss, { token: tokenOf(1) }, { ...h.deps, lock: { waitLock: () => { throw new Error("t"); }, releaseLock: () => {} } })).toEqual({ ok: false, error: "busy" });
    expect(h.ss.snapshot()).toBe(snap);
  });
});

describe("waOpened refuses what it cannot place, the same way each time", () => {
  const NOT_FOUND = { ok: false, error: "not-found" };
  it.each([["unknown token", { token: "tok-9999" }], ["empty token", { token: "" }], ["missing token", {}], ["numeric token", { token: 5 }], ["a non-object", "x"], ["null", null]])(
    "%s: not-found, nothing written",
    async (_l, request) => {
      const h = harness(build(SEED));
      const snap = h.ss.snapshot();
      expect(await run(h.ss, request, h.deps)).toEqual(NOT_FOUND);
      expect(h.ss.snapshot()).toBe(snap);
    },
  );

  it("a token that is not a string takes no lock and reads nothing", async () => {
    const h = harness(build(SEED));
    h.events.length = 0;
    await run(h.ss, { token: 5 }, h.deps);
    expect(h.events).toEqual([]);
  });

  it("answers not-reserving, without the lock, when there is no Bookings tab", async () => {
    const ss = build(SEED);
    ss.tabs = ss.tabs.filter((t) => t.name !== "Bookings");
    const h = harness(ss);
    expect(await run(h.ss, { token: tokenOf(1) }, h.deps)).toEqual({ ok: false, error: "not-reserving" });
    expect(h.events).not.toContain("waitLock");
  });
});

describe("waOpened does not touch the catalogue cache", () => {
  // A Bookings stamp cannot change what the catalogue shows, so clearing the cache would only cost a cold catalogue rebuild
  // per WhatsApp handoff (QA flag b). The write itself still happens, flushed and under the lock.
  const cacheClears = (h: ReturnType<typeof harness>) => h.events.filter((e) => e === `cache:${CATALOGUE_CACHE_KEY}`).length;

  it("a first stamp writes the cell but clears no cache entry", async () => {
    const h = harness(build(SEED));
    await run(h.ss, { token: tokenOf(1) }, h.deps);
    expect(openedOf(h, 1)).toBe(NOW); // the premise: a write really happened
    expect(cacheClears(h)).toBe(0);
  });

  it("a repeat, a miss and a busy answer clear none either", async () => {
    const h = harness(build(SEED));
    await run(h.ss, { token: tokenOf(1) }, h.deps);
    h.events.length = 0; // the first stamp is covered above; only what follows is counted here
    await run(h.ss, { token: tokenOf(1) }, h.deps);
    await run(h.ss, { token: "tok-9999" }, h.deps);
    await run(h.ss, { token: tokenOf(1) }, { ...h.deps, lock: { waitLock: () => { throw new Error("t"); }, releaseLock: () => {} } });
    expect(cacheClears(h)).toBe(0);
  });
});
