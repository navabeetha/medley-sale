// S-11: POST request handling (brief 4.3: POST bodies are sent as text/plain JSON
// to avoid a CORS preflight; tokens travel in the body, never the query string).
//
// DESIGNED INTERFACE (the spec for src/api/handle-post.ts, mirroring handle-get.ts):
//
//   handlePost(
//     body: string | undefined,                     // e.postData.contents
//     deps: { reserve, booking, backOut: (request: unknown) => unknown },   // booking and backOut added by S-12 / S-14
//   ): string                                       // JSON body; never throws
//
//   - body is parsed as JSON; the object's `action` picks the handler.
//   - action "reserve": the PARSED OBJECT is passed to deps.reserve and its
//     return value is JSON.stringify'd as the answer.
//   - action "booking" (S-12) and "backOut" (S-14): the same, through deps.booking and deps.backOut. The PARSED OBJECT
//     (token, claimId) comes from the POST BODY only: handlePost has no query-string input, and doGet never routes them.
//   - any other action (including waOpened until S-13 lands): {"error":"unknown action"}, never echoed back.
//   - missing, empty, non-JSON, or non-object body: {"error":"bad request"}.
//   - if the handler for the action throws (reserve, booking or backOut): {"error":"unavailable"}, generic on purpose, so an
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
import { handleGet } from "../../src/api/handle-get";
import { handlePost, type PostDeps } from "../../src/api/handle-post";

/** All handlers present (S-12 / S-14 made booking and backOut required); a test overrides the one it cares about. */
const deps = (over: Partial<PostDeps> = {}): PostDeps => ({ reserve: () => ({}), booking: () => ({}), backOut: () => ({}), ...over });

describe("handlePost", () => {
  it("passes a parsed reserve request to the reserve handler and returns its answer as JSON", () => {
    const seen: unknown[] = [];
    const out = handlePost(JSON.stringify({ action: "reserve", name: "Asha Testperson" }), deps({
      reserve: (r) => { seen.push(r); return { ok: true, token: "t" }; },
    }));
    expect(seen).toEqual([{ action: "reserve", name: "Asha Testperson" }]);
    expect(JSON.parse(out)).toEqual({ ok: true, token: "t" });
  });

  it.each([
    ["waOpened"], ["Booking"], [" backOut"], ["BACKOUT"], ["back-out"], ["catalogue"], ["RESERVE"], [" reserve"], [""],
  ])("answers unknown action %j with an error and does not call reserve", (action) => {
    let called = 0;
    const out = handlePost(JSON.stringify({ action }), deps({ reserve: () => { called++; return {}; }, booking: () => { called++; return {}; }, backOut: () => { called++; return {}; } }));
    expect(JSON.parse(out)).toEqual({ error: "unknown action" });
    expect(called).toBe(0);
  });

  it("does not echo an attacker-supplied action back", () => {
    const out = handlePost(JSON.stringify({ action: "<script>x</script>" }), deps({ reserve: () => ({}) }));
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
    const out = handlePost(body, deps({ reserve: () => { called++; return {}; }, booking: () => { called++; return {}; }, backOut: () => { called++; return {}; } }));
    expect(JSON.parse(out)).toEqual({ error: "bad request" });
    expect(called).toBe(0);
  });

  it("answers a generic error, with no message text, when reserve throws", () => {
    const out = handlePost(JSON.stringify({ action: "reserve" }), deps({
      reserve: () => { throw new Error("cell holds Zed Buyer +91 90000 00012"); },
    }));
    expect(JSON.parse(out)).toEqual({ error: "unavailable" });
    expect(out).not.toContain("Zed");
    expect(out).not.toContain("90000");
  });
});

describe("handlePost: booking and backOut (S-12, S-14)", () => {
  for (const action of ["booking", "backOut"] as const) {
    const others = (hit: string[]): Partial<PostDeps> => ({
      reserve: () => { hit.push("reserve"); return {}; },
      booking: action === "booking" ? undefined as never : () => { hit.push("booking"); return {}; },
      backOut: action === "backOut" ? undefined as never : () => { hit.push("backOut"); return {}; },
    });

    it(`${action}: passes the parsed body object (token and claim id) to its own handler only, and returns its answer as JSON`, () => {
      const seen: unknown[] = [];
      const hit: string[] = [];
      const out = handlePost(JSON.stringify({ action, token: "tok-0001", claimId: 4 }), deps({
        ...others(hit),
        [action]: (r: unknown) => { seen.push(r); return { ok: true, marker: action }; },
      }));
      expect(seen).toEqual([{ action, token: "tok-0001", claimId: 4 }]);
      expect(JSON.parse(out)).toEqual({ ok: true, marker: action });
      expect(hit).toEqual([]);
    });

    it(`${action}: answers a generic unavailable error, with no message text, when its handler throws`, () => {
      const out = handlePost(JSON.stringify({ action, token: "tok-0001" }), deps({
        [action]: () => { throw new Error("Zed Buyer +91 90000 00012 tok-0001"); },
      }));
      expect(JSON.parse(out)).toEqual({ error: "unavailable" });
      expect(out).not.toContain("Zed");
      expect(out).not.toContain("90000");
      expect(out).not.toContain("tok-0001");
    });

    it(`${action}: a handler that returns undefined or a non-object still yields JSON and never throws`, () => {
      expect(() => handlePost(JSON.stringify({ action }), deps({ [action]: () => undefined }))).not.toThrow();
    });
  }

  it("a booking request does not reach reserve or backOut, and a backOut request does not reach booking", () => {
    const hit: string[] = [];
    const d = deps({
      reserve: () => { hit.push("reserve"); return {}; },
      booking: () => { hit.push("booking"); return {}; },
      backOut: () => { hit.push("backOut"); return {}; },
    });
    handlePost(JSON.stringify({ action: "booking", token: "x" }), d);
    handlePost(JSON.stringify({ action: "backOut", token: "x", claimId: 1 }), d);
    expect(hit).toEqual(["booking", "backOut"]);
  });

  it("tokens are accepted from the POST body only: GET never serves booking or backOut, whatever the query carries", () => {
    for (const action of ["booking", "backOut"]) {
      let built = 0;
      const out = handleGet({ action, token: "tok-0001", claimId: "1" }, { catalogue: () => { built++; return {}; } });
      expect(JSON.parse(out)).toEqual({ error: "unknown action" });
      expect(built).toBe(0);
      expect(out).not.toContain("tok-0001");
    }
  });
});
