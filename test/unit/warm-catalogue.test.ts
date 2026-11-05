// R1 / D-034: the time-driven warm job. Interface chosen by the test author:
//
//   // src/api/warm-catalogue.ts
//   warmCatalogue(deps: { catalogue: () => unknown; cache: GetCache; log?: (line: string) => void }): boolean
//
// true = a fresh body was cached; false = the build or the cache write failed.
// It never throws. It must not stop at an existing cache entry (the whole point
// is to replace a stale one). Synthetic data only.
import { describe, expect, it } from "vitest";
import { CATALOGUE_CACHE_KEY, CATALOGUE_CACHE_SECONDS, handleGet } from "../../src/api/handle-get";
import { warmCatalogue } from "../../src/api/warm-catalogue";

const DATA = { items: [{ id: "I-0001", name: "Echo Dot" }], contactUrl: null };
const LEAKY = "Asha Testperson +91 90000 00011";

function memoryCache() {
  const store = new Map<string, string>();
  const puts: { k: string; v: string; secs: number }[] = [];
  return {
    store, puts,
    get: (k: string) => store.get(k) ?? null,
    put: (k: string, v: string, secs: number) => { puts.push({ k, v, secs }); store.set(k, v); },
  };
}

describe("cache lifetime (D-034 rule 1)", () => {
  it("is 10 minutes, twice the 5-minute warm interval", () => {
    expect(CATALOGUE_CACHE_SECONDS).toBe(600);
  });
});

describe("warmCatalogue", () => {
  it("builds the catalogue and caches its JSON under the catalogue key for the cache lifetime", () => {
    const cache = memoryCache();
    expect(warmCatalogue({ catalogue: () => DATA, cache })).toBe(true);
    expect(cache.puts).toEqual([{ k: CATALOGUE_CACHE_KEY, v: JSON.stringify(DATA), secs: CATALOGUE_CACHE_SECONDS }]);
  });

  it("replaces a stale cached body instead of keeping it", () => {
    const cache = memoryCache();
    cache.store.set(CATALOGUE_CACHE_KEY, JSON.stringify({ items: [], contactUrl: null }));
    warmCatalogue({ catalogue: () => DATA, cache });
    expect(cache.store.get(CATALOGUE_CACHE_KEY)).toBe(JSON.stringify(DATA));
  });

  it("makes the next visitor's handleGet a hit that never calls the catalogue builder", () => {
    const cache = memoryCache();
    warmCatalogue({ catalogue: () => DATA, cache });
    let calls = 0;
    const body = handleGet({ action: "catalogue" }, { catalogue: () => { calls++; return DATA; }, cache });
    expect(calls).toBe(0);
    expect(JSON.parse(body)).toEqual(DATA);
  });

  it("caches the same body handleGet would build on a miss", () => {
    const warm = memoryCache();
    warmCatalogue({ catalogue: () => DATA, cache: warm });
    const miss = memoryCache();
    const body = handleGet({ action: "catalogue" }, { catalogue: () => DATA, cache: miss });
    expect(warm.store.get(CATALOGUE_CACHE_KEY)).toBe(body);
  });

  it("returns false, caches nothing and does not throw when the build fails", () => {
    const cache = memoryCache();
    const run = () => warmCatalogue({ catalogue: () => { throw new Error(LEAKY); }, cache });
    expect(run).not.toThrow();
    expect(run()).toBe(false);
    expect(cache.puts).toEqual([]);
  });

  it("leaves the previous good cached body in place when the build fails (never caches an error body)", () => {
    const cache = memoryCache();
    cache.store.set(CATALOGUE_CACHE_KEY, JSON.stringify(DATA));
    warmCatalogue({ catalogue: () => { throw new Error("boom"); }, cache });
    expect(cache.store.get(CATALOGUE_CACHE_KEY)).toBe(JSON.stringify(DATA));
    expect(cache.puts).toEqual([]);
  });

  it("returns false and does not throw when the cache write fails", () => {
    const cache = { get: () => null, put: () => { throw new Error("quota"); } };
    expect(warmCatalogue({ catalogue: () => DATA, cache })).toBe(false);
  });

  it("logs a failure without echoing the exception text (it could contain cell content)", () => {
    const lines: string[] = [];
    warmCatalogue({ catalogue: () => { throw new Error(LEAKY); }, cache: memoryCache(), log: (l) => lines.push(l) });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain("Asha");
    expect(lines.join("\n")).not.toContain("90000");
  });

  it("does not throw when the log sink itself throws", () => {
    const log = () => { throw new Error("log down"); };
    expect(() => warmCatalogue({ catalogue: () => { throw new Error("x"); }, cache: memoryCache(), log })).not.toThrow();
  });
});
