// S-04 QA F3: GET request handling moves out of the Apps Script adapter into a pure function.
//
//   handleGet(
//     params: Record<string, string | undefined>,
//     deps: { catalogue: () => unknown; cache?: { get(k: string): string | null; put(k: string, v: string, secs: number): void } },
//   ): string        // the JSON body, always valid JSON, never throws
//
// Expected module: src/api/handle-get.ts. Brief 4.3: all responses are JSON. Synthetic data only.
import { describe, expect, it } from "vitest";
import { handleGet } from "../../src/api/handle-get";

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

const DATA = { items: [{ id: "I-0001", name: "Echo Dot" }] };

describe("handleGet", () => {
  it("answers action=catalogue with the catalogue as JSON", () => {
    const body = handleGet({ action: "catalogue" }, { catalogue: () => DATA });
    expect(JSON.parse(body)).toEqual(DATA);
  });

  it("serves a cache hit without calling the catalogue", () => {
    const cache = memoryCache();
    cache.store.set("catalogue", JSON.stringify({ items: [] }));
    let calls = 0;
    const body = handleGet({ action: "catalogue" }, { catalogue: () => { calls++; return DATA; }, cache });
    expect(body).toBe(JSON.stringify({ items: [] }));
    expect(calls).toBe(0);
  });

  it("on a miss builds the catalogue and caches the exact body under 'catalogue' for 30 seconds", () => {
    const cache = memoryCache();
    const body = handleGet({ action: "catalogue" }, { catalogue: () => DATA, cache });
    expect(cache.puts).toEqual([{ k: "catalogue", v: body, secs: 30 }]);
  });

  it("a second call after a miss is served from the cache", () => {
    const cache = memoryCache();
    let calls = 0;
    const deps = { catalogue: () => { calls++; return DATA; }, cache };
    handleGet({ action: "catalogue" }, deps);
    handleGet({ action: "catalogue" }, deps);
    expect(calls).toBe(1);
  });

  it("works with no cache at all", () => {
    expect(JSON.parse(handleGet({ action: "catalogue" }, { catalogue: () => DATA }))).toEqual(DATA);
  });

  it.each([{}, { action: undefined }, { action: "" }, { action: "reserve" }, { action: "Catalogue" }, { action: "catalogue " }])(
    "answers %j with the unknown action error and does not call the catalogue",
    (params) => {
      let calls = 0;
      const body = handleGet(params as Record<string, string | undefined>, { catalogue: () => { calls++; return DATA; } });
      expect(JSON.parse(body)).toEqual({ error: "unknown action" });
      expect(calls).toBe(0);
    },
  );

  it("does not echo the unknown action back", () => {
    const body = handleGet({ action: LEAKY }, { catalogue: () => DATA });
    expect(body).not.toContain("Asha");
    expect(body).not.toContain("90000");
  });

  it("turns a throwing catalogue into the generic JSON error, leaking none of the message", () => {
    const body = handleGet({ action: "catalogue" }, { catalogue: () => { throw new Error(`bad row for ${LEAKY}`); } });
    expect(JSON.parse(body)).toEqual({ error: "unavailable" });
    expect(body).not.toContain("Asha");
    expect(body).not.toContain("90000");
    expect(body).not.toContain("bad row");
  });

  it("copes with a non-Error throw", () => {
    const body = handleGet({ action: "catalogue" }, { catalogue: () => { throw LEAKY; } });
    expect(JSON.parse(body)).toEqual({ error: "unavailable" });
  });

  it("caches nothing when the catalogue throws", () => {
    const cache = memoryCache();
    handleGet({ action: "catalogue" }, { catalogue: () => { throw new Error(LEAKY); }, cache });
    expect(cache.puts).toEqual([]);
  });

  it("still answers from the catalogue when the cache read throws", () => {
    const cache = { get: () => { throw new Error(LEAKY); }, put: () => undefined };
    const body = handleGet({ action: "catalogue" }, { catalogue: () => DATA, cache });
    expect(JSON.parse(body)).toEqual(DATA);
  });

  it("still answers from the catalogue when the cache write throws", () => {
    const cache = { get: () => null, put: () => { throw new Error(LEAKY); } };
    const body = handleGet({ action: "catalogue" }, { catalogue: () => DATA, cache });
    expect(JSON.parse(body)).toEqual(DATA);
    expect(body).not.toContain("Asha");
  });
});
