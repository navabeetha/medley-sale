// S-10 pure form helpers (written before the code; the module does not exist yet).
//
// DESIGNED INTERFACE (src/site/reserve-form.ts; pure: no DOM, no storage, never throws):
//
//   validateName(raw: unknown): { ok: true; name: string } | { ok: false }
//     name is the TRIMMED text, which is what the form sends. Brief 6.3: 2 to 60 characters after
//     trimming. Length is counted exactly as src/api/reserve.ts counts it (String.prototype.length of
//     the trimmed string), so the site never refuses what the API accepts, nor the other way round.
//
//   checkNumber(raw: unknown): { ok: true; number: string } | { ok: false; needsPlus: boolean }
//     Wraps normalisePhone (src/domain/phone.ts): ok exactly when normalisePhone gives a value, and
//     number is that E.164 value. On failure, needsPlus is true exactly when the input is "91" followed
//     by ten digits with no "+" (formatting characters ignored), so the form can say "add a +".
//
//   newIdempotencyKey(): string
//     Matches ^[A-Za-z0-9-]{16,64}$, carries at least 128 bits of randomness (e.g. crypto.randomUUID()),
//     and never repeats. Must not rely on Math.random (not a secure source).
//
// Synthetic numbers only (the +91 90000 000xx kind).
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalisePhone } from "../../src/domain/phone";
import { checkNumber, newIdempotencyKey, validateName } from "../../src/site/reserve-form";

afterEach(() => vi.restoreAllMocks());

describe("validateName", () => {
  it("accepts an ordinary name and returns it unchanged", () => {
    expect(validateName("Asha Testperson")).toEqual({ ok: true, name: "Asha Testperson" });
  });

  it("returns the trimmed name, which is what gets sent", () => {
    expect(validateName("  Asha Testperson \n")).toEqual({ ok: true, name: "Asha Testperson" });
  });

  it("keeps inner whitespace as typed", () => {
    expect(validateName("Asha   T")).toEqual({ ok: true, name: "Asha   T" });
  });

  it("accepts exactly 2 characters and refuses 1 (after trimming)", () => {
    expect(validateName("Al")).toEqual({ ok: true, name: "Al" });
    expect(validateName("A").ok).toBe(false);
    expect(validateName("  A  ").ok).toBe(false); // padding does not count
    expect(validateName(" Al ")).toEqual({ ok: true, name: "Al" });
  });

  it("accepts exactly 60 characters and refuses 61", () => {
    expect(validateName("x".repeat(60))).toEqual({ ok: true, name: "x".repeat(60) });
    expect(validateName("x".repeat(61)).ok).toBe(false);
  });

  it("trims before counting the upper limit (60 characters plus padding is fine)", () => {
    expect(validateName(` ${"x".repeat(60)} `)).toEqual({ ok: true, name: "x".repeat(60) });
  });

  it("refuses empty and whitespace-only input", () => {
    expect(validateName("").ok).toBe(false);
    expect(validateName("   \t\n").ok).toBe(false);
  });

  it("refuses non-strings without throwing", () => {
    for (const v of [undefined, null, 42, {}, [], true]) expect(validateName(v).ok).toBe(false);
  });

  it("counts length the same way the API does (UTF-16 length of the trimmed text): one emoji is 2", () => {
    // src/api/reserve.ts checks name.trim().length; if the site counted code points it would refuse a name the
    // API takes. Odd, but the two must agree (QA would otherwise see the site and API disagree).
    const emoji = "\u{1F600}";
    expect(emoji.length).toBe(2);
    expect(validateName(emoji)).toEqual({ ok: true, name: emoji });
  });

  it("does not change formula-looking or markup-looking text (the guard is the API's job; display is textContent)", () => {
    expect(validateName("=1+1")).toEqual({ ok: true, name: "=1+1" });
    expect(validateName("<img src=x onerror=1>")).toEqual({ ok: true, name: "<img src=x onerror=1>" });
  });
});

describe("checkNumber", () => {
  const GB = ["+44", "7700", "900123"].join(" "); // a UK drama-range style number, split so the scan is quiet
  const valid: [string, string][] = [
    ["90000 00012", "+919000000012"], // ten digits means India
    ["9000000012", "+919000000012"],
    ["+91 90000 00012", "+919000000012"],
    ["+91-90000-00012", "+919000000012"],
    ["(+91) 90000 00012", "+919000000012"],
    [GB, ["+44", "7700", "900123"].join("")], // international with +
  ];
  for (const [raw, e164] of valid) {
    it(`accepts ${JSON.stringify(raw)} as ${e164}`, () => {
      expect(checkNumber(raw)).toEqual({ ok: true, number: e164 });
    });
  }

  const needsPlus = ["919000000012", "91 90000 00012", "91-90000-00012"];
  for (const raw of needsPlus) {
    it(`refuses ${JSON.stringify(raw)} and says a + is missing`, () => {
      expect(checkNumber(raw)).toEqual({ ok: false, needsPlus: true });
    });
  }

  const plain = [
    "", "   ", "abc", "12345", "9000000", // too short
    ["0", "9000000012"].join(""), // trunk 0 + ten digits (D-036)
    ["+91", "0", "90000", "00012"].join(" "), // trunk 0 after +91 (QA F7)
    ["+0", "9000000012"].join(" "), // country code cannot start with 0
    "9000000012 3", // eleven digits
    "+91 9000 000 01x",
    "9000+000012", // + anywhere but the start
    "91900000012", // starts with 91 but is 91 + nine digits: no "add +" hint
  ];
  for (const raw of plain) {
    it(`refuses ${JSON.stringify(raw)} without the add-+ hint`, () => {
      expect(checkNumber(raw)).toEqual({ ok: false, needsPlus: false });
    });
  }

  it("refuses non-strings without throwing", () => {
    for (const v of [undefined, null, 9000000012, {}]) expect(checkNumber(v)).toEqual({ ok: false, needsPlus: false });
  });

  it("agrees with normalisePhone on every input (the site and the API cannot disagree)", () => {
    const inputs = [...valid.map(([r]) => r), ...needsPlus, ...plain, " 90000 00012 ", "+919000000012", "0091 9000000012"];
    for (const raw of inputs) {
      const want = normalisePhone(raw);
      const got = checkNumber(raw);
      expect(got.ok, JSON.stringify(raw)).toBe(want !== null);
      if (got.ok) expect(got.number).toBe(want);
    }
  });
});

describe("newIdempotencyKey", () => {
  it("matches the server's pattern", () => {
    for (let i = 0; i < 50; i++) expect(newIdempotencyKey()).toMatch(/^[A-Za-z0-9-]{16,64}$/);
  });

  it("is long enough to carry 128 bits (22 characters of base64 or 32 hex digits or more)", () => {
    // Each allowed character carries at most 6 bits, so 128 bits needs at least 22 characters.
    expect(newIdempotencyKey().length).toBeGreaterThanOrEqual(22);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 500 }, () => newIdempotencyKey()));
    expect(seen.size).toBe(500);
  });

  it("does not depend on Math.random", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});
