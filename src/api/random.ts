// Pure bit-extraction for token randomness (D-005). main.ts feeds it UUIDs.

/**
 * Turns random (v4) UUIDs into n random bytes. The fixed version digit (hex
 * index 12) and variant digit (index 16) of each UUID are dropped, leaving 30
 * random hex digits (15 bytes) per UUID; the digits of all UUIDs are joined and
 * read two at a time. Throws when the UUIDs hold too few digits for n bytes.
 */
export function uuidsToBytes(uuids: string[], n: number): Uint8Array {
  const digits: string[] = [];
  for (const u of uuids) {
    const hex = u.replace(/-/g, "");
    digits.push(...[...hex].filter((_, i) => i !== 12 && i !== 16));
  }
  if (digits.length < n * 2) throw new Error("not enough random digits for the requested bytes");
  return Uint8Array.from({ length: n }, (_, i) => parseInt(digits[2 * i]! + digits[2 * i + 1]!, 16));
}
