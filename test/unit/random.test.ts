import { describe, expect, it } from "vitest";
import { uuidsToBytes } from "../../src/api/random";

// F8: the bit-extraction behind tokens (D-005). A v4 UUID has 122 random bits;
// its version digit (hex index 12) and variant digit (index 16) are fixed in
// part. The extraction must never let those fixed bits show up in a token.

/** Seeded generator (mulberry32) so the synthetic UUIDs are reproducible. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A syntactically valid v4 UUID: version digit 4, variant digit one of 8 9 a b. */
function fakeUuid(r: () => number): string {
  const h = Array.from({ length: 32 }, () => Math.floor(r() * 16).toString(16));
  h[12] = "4";
  h[16] = "89ab"[Math.floor(r() * 4)]!;
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
const BASE = "00112233-4455-4677-8899-aabbccddeeff";
const twoUuids = (r: () => number) => [fakeUuid(r), fakeUuid(r)];

describe("uuidsToBytes", () => {
  it.each([0, 1, 15, 16, 20])("returns exactly %i bytes", (n) => {
    const r = rng(1);
    const out = uuidsToBytes([fakeUuid(r), fakeUuid(r), fakeUuid(r)], n);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out).toHaveLength(n);
  });

  it("is deterministic for the same input", () => {
    const u = twoUuids(rng(2));
    expect(uuidsToBytes(u, 16)).toEqual(uuidsToBytes(u, 16));
  });

  it("ignores the version digit of the UUID", () => {
    const changed = BASE.replace("-4677-", "-1677-"); // hex index 12: 4 -> 1
    expect(uuidsToBytes([changed, BASE], 16)).toEqual(uuidsToBytes([BASE, BASE], 16));
  });

  it("depends on the random digits (changing one changes the output)", () => {
    const changed = BASE.replace("-4455-", "-4456-"); // a random digit, not 12 or 16
    expect(uuidsToBytes([changed, BASE], 16)).not.toEqual(uuidsToBytes([BASE, BASE], 16));
  });

  it("does not depend on dashes or letter case", () => {
    const plain = BASE.replace(/-/g, "").toUpperCase();
    expect(uuidsToBytes([plain, plain], 16)).toEqual(uuidsToBytes([BASE, BASE], 16));
  });

  it("refuses to pad when the UUIDs hold too few random digits for n bytes", () => {
    // One UUID carries 30 usable hex digits = 15 bytes at most.
    expect(() => uuidsToBytes([BASE], 16)).toThrow();
    expect(() => uuidsToBytes([], 1)).toThrow();
  });

  it("leaves no byte constant, and no bit constant, over many synthetic UUIDs", () => {
    const r = rng(42);
    const runs = Array.from({ length: 600 }, () => uuidsToBytes(twoUuids(r), 16));
    for (let i = 0; i < 16; i++) {
      const values = new Set(runs.map((b) => b[i]));
      expect(values.size, `byte ${i} takes more than one value`).toBeGreaterThan(1);
      // Every bit must take both values: a fixed version or variant bit would not.
      for (let bit = 0; bit < 8; bit++) {
        const ones = runs.filter((b) => (b[i]! >> bit) & 1).length;
        expect(ones, `byte ${i} bit ${bit} is constant`).toBeGreaterThan(0);
        expect(ones, `byte ${i} bit ${bit} is constant`).toBeLessThan(runs.length);
      }
    }
  });
});
