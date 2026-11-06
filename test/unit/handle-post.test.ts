// S-11: POST request handling (brief 4.3: POST bodies are sent as text/plain JSON
// to avoid a CORS preflight; tokens travel in the body, never the query string).
//
// DESIGNED INTERFACE (the spec for src/api/handle-post.ts, mirroring handle-get.ts):
//
//   handlePost(
//     body: string | undefined,                     // e.postData.contents
//     deps: { reserve: (request: unknown) => unknown },
//   ): string                                       // JSON body; never throws
//
//   - body is parsed as JSON; the object's `action` picks the handler.
//   - action "reserve": the PARSED OBJECT is passed to deps.reserve and its
//     return value is JSON.stringify'd as the answer.
//   - any other action (including booking/backOut/waOpened until S-12/S-14 land):
//     {"error":"unknown action"} and the action is never echoed back.
//   - missing, empty, non-JSON, or non-object body: {"error":"bad request"}.
//   - if deps.reserve throws: {"error":"unavailable"}, generic on purpose, so an
//     exception message that holds a name or number can never leave (D-030 rule 8).
//
// The Apps Script adapter (src/appscript/main.ts `doPostRun`, and the top-level
// `function doPost(e)` in tools/build-gas.mjs, pinned in appscript-bundle.test.ts)
// wires LockService.getScriptLock(), CacheService, Utilities.getUuid() randomness
// and the Script Properties SELLER_WHATSAPP and SITE_URL into reserve(). That
// wiring is thin and cannot be unit-tested; it is covered by the live T-18 check
// (10 parallel requests for a quantity 1 item give 1 holder and 9 waiting, no
// lost or duplicate rows), which needs G0.3 and is NOT in CI.
import { describe, expect, it } from "vitest";
import { handlePost } from "../../src/api/handle-post";

describe("handlePost", () => {
  it("passes a parsed reserve request to the reserve handler and returns its answer as JSON", () => {
    const seen: unknown[] = [];
    const out = handlePost(JSON.stringify({ action: "reserve", name: "Asha Testperson" }), {
      reserve: (r) => { seen.push(r); return { ok: true, token: "t" }; },
    });
    expect(seen).toEqual([{ action: "reserve", name: "Asha Testperson" }]);
    expect(JSON.parse(out)).toEqual({ ok: true, token: "t" });
  });

  it.each([
    ["booking"], ["backOut"], ["waOpened"], ["catalogue"], ["RESERVE"], [" reserve"], [""],
  ])("answers unknown action %j with an error and does not call reserve", (action) => {
    let called = 0;
    const out = handlePost(JSON.stringify({ action }), { reserve: () => { called++; return {}; } });
    expect(JSON.parse(out)).toEqual({ error: "unknown action" });
    expect(called).toBe(0);
  });

  it("does not echo an attacker-supplied action back", () => {
    const out = handlePost(JSON.stringify({ action: "<script>x</script>" }), { reserve: () => ({}) });
    expect(out).not.toContain("script");
  });

  it.each([
    ["undefined", undefined],
    ["an empty string", ""],
    ["text that is not JSON", "action=reserve"],
    ["a JSON string", '"reserve"'],
    ["a JSON array", "[1]"],
    ["JSON null", "null"],
    ["a JSON number", "7"],
  ])("answers a bad body (%s) with a bad request error, without throwing", (_label, body) => {
    let called = 0;
    const out = handlePost(body, { reserve: () => { called++; return {}; } });
    expect(JSON.parse(out)).toEqual({ error: "bad request" });
    expect(called).toBe(0);
  });

  it("answers a generic error, with no message text, when reserve throws", () => {
    const out = handlePost(JSON.stringify({ action: "reserve" }), {
      reserve: () => { throw new Error("cell holds Zed Buyer +91 90000 00012"); },
    });
    expect(JSON.parse(out)).toEqual({ error: "unavailable" });
    expect(out).not.toContain("Zed");
    expect(out).not.toContain("90000");
  });
});
