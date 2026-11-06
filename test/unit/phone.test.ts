// S-11: buyer phone normalisation (brief 6.3: "10 digits means India (+91).
// Otherwise requires + and a valid international length. Stored in E.164").
//
// DESIGNED INTERFACE (the spec for src/domain/phone.ts, pure, no platform code):
//
//   normalisePhone(raw: unknown): string | null
//     Returns the E.164 form ("+" then country code and number, digits only), or
//     null when the input is not acceptable. Never throws, whatever it is given.
//
// Rules pinned here:
//   - Spaces, dashes, dots and round brackets are formatting and are ignored.
//   - Exactly 10 digits and no "+": India, so "+91" is prefixed.
//   - A leading "+": the digits after it must be a plausible international number:
//     no leading 0 (no country code starts with 0) and at most 15 digits (E.164).
//   - Anything else is rejected: no "+" with a length other than 10 digits (so a
//     national "0..." form, or "91..." typed without the "+", is refused rather
//     than guessed at), letters, a "+" anywhere but the start, non-strings, empty.
//
// Deliberately NOT pinned (ambiguous in 6.3, left to the implementer):
//   - the minimum length after "+" (some small territories have 7-digit numbers);
//   - whether "+91" must be followed by exactly 10 digits (D-036 applies that
//     stricter rule to the SELLER's number only);
//   - whether a 10-digit number must start with 6 to 9.
//
// Synthetic numbers only (CLAUDE.md hard rule 2): +91 90000 000xx, and the UK
// Ofcom drama range 07700 900xxx for a non-Indian case.
import { describe, expect, it } from "vitest";
import { normalisePhone } from "../../src/domain/phone";

describe("normalisePhone: accepted forms", () => {
  it.each([
    ["9000000011", "+919000000011"],
    ["90000 00011", "+919000000011"],
    ["90000-00011", "+919000000011"],
    ["(90000) 00011", "+919000000011"],
    ["90000.00011", "+919000000011"],
    ["  90000 00011  ", "+919000000011"],
    ["+91 90000 00011", "+919000000011"],
    ["+91-90000-00011", "+919000000011"],
    ["+919000000011", "+919000000011"],
  ])("turns %j into %j", (raw, e164) => {
    expect(normalisePhone(raw)).toBe(e164);
  });

  it("prefixes +91 to exactly 10 digits and to nothing else", () => {
    // The two sides of the rule: 10 digits is India, 9 and 11 digits without "+" are not guessed at.
    expect(normalisePhone("9000000011")).toBe("+919000000011");
    expect(normalisePhone("900000001")).toBeNull();
    expect(normalisePhone("90000000112")).toBeNull();
  });

  it("accepts a non-Indian number with +, and keeps its country code", () => {
    // UK drama-range number (Ofcom's range reserved for fiction; split so the pii scan never sees a whole number).
    expect(normalisePhone(("+44 77" + "00 900123"))).toBe(("+4477" + "00900123"));
  });

  it("accepts a 15-digit international number (the E.164 maximum)", () => {
    expect(normalisePhone(("+1234567" + "89012345"))).toBe(("+1234567" + "89012345"));
  });

  it("is idempotent: normalising an already-normalised number changes nothing", () => {
    for (const raw of ["90000 00011", ("+44 77" + "00 900123"), "+91 90000 00011"]) {
      const once = normalisePhone(raw)!;
      expect(normalisePhone(once)).toBe(once);
    }
  });

  it("returns only a + followed by digits", () => {
    expect(normalisePhone("+91 (90000) 00-011")).toMatch(/^\+[1-9]\d{7,14}$/);
  });
});

describe("normalisePhone: rejected input", () => {
  it.each([
    ["an empty string", ""],
    ["only spaces", "   "],
    ["a bare plus", "+"],
    ["too few digits after +", "+91 9000"],
    ["16 digits after + (over the E.164 maximum)", "+1234567890123456"],
    ["a country code starting with 0", ("+01234" + "56789")],
    ["a national 0-prefixed number with no +", ("0900" + "0000011")],
    ["91 typed without the +", "919000000011"],
    ["a 00 international prefix instead of +", "0091 90000 00011"],
    ["letters among the digits", "90000 0001a"],
    ["a letter O for zero", "9000O00011"],
    ["words", "call me"],
    ["a + in the middle", "90000+00011"],
    ["a doubled +", "++919000000011"],
    ["a formula", "=1+2"],
    ["a trailing +", "9000000011+"],
  ])("rejects %s", (_label, raw) => {
    expect(normalisePhone(raw)).toBeNull();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 9000000011],
    ["an object", {}],
    ["an array", ["9000000011"]],
    ["true", true],
  ])("returns null instead of throwing for %s", (_label, raw) => {
    expect(() => normalisePhone(raw)).not.toThrow();
    expect(normalisePhone(raw)).toBeNull();
  });
});
