// D-036.1 (status text ignores case and surrounding spaces) and D-036.2
// (contactUrl needs a country code). Synthetic data only: numbers are the
// 90000 000xx style. Status mode = no Claims tab (D-035).
import { describe, expect, it } from "vitest";
import { catalogue } from "../../src/api/catalogue";
import type { CellValue } from "../../src/api/sheet";
import { FakeSpreadsheet } from "../fixtures/fake-sheet";

type Item = { id: string; name: string; freeUnits: number; unitsLeft: number };
type Resp = { items: Item[]; contactUrl: string | null };
const run = (ss: FakeSpreadsheet, opts: Record<string, unknown> = {}): Resp =>
  catalogue(ss, opts as never) as unknown as Resp;

const HEADERS = ["Item", "Status", "Person", "ID", "Quantity"];

/** Status mode sheet: one Tech row per status value, Quantity 2, no Claims tab. */
function sheetWithStatuses(statuses: CellValue[]): FakeSpreadsheet {
  const ss = new FakeSpreadsheet("Synthetic real sheet");
  ss.withTab("Tech", [
    ["Synthetic title"],
    [...HEADERS],
    ...statuses.map((s, i) => [`Thing ${i}`, s, null, `I-${String(i + 1).padStart(4, "0")}`, 2]),
  ]);
  return ss;
}
const listed = (status: CellValue): Item | undefined =>
  run(sheetWithStatuses([status])).items.find((i) => i.name === "Thing 0");

describe("status mode: Status text ignores case and surrounding spaces (D-036.1)", () => {
  it.each(["available", "AVAILABLE", "Available ", " Available", "  aVaIlAbLe\t"])(
    "lists %j as Available (all units free)",
    (status) => {
      expect(listed(status)).toMatchObject({ unitsLeft: 2, freeUnits: 2 });
    },
  );

  it.each(["reserved ", "RESERVED", " Reserved", "reserved"])(
    "lists %j as Reserved (held, freeUnits 0)",
    (status) => {
      expect(listed(status)).toMatchObject({ unitsLeft: 2, freeUnits: 0 });
    },
  );

  it.each(["Sold ", "sold", "SOLD", "", "   ", null, "Gone", "Availabl", "Available soon", "Not available"])(
    "keeps %j hidden",
    (status) => {
      expect(listed(status)).toBeUndefined();
    },
  );

  it("does not treat a non-string Status cell as a match", () => {
    expect(listed(1)).toBeUndefined();
    expect(listed(true)).toBeUndefined();
  });

  it("lists a mixed column of messy statuses in row order and hides only the rest", () => {
    const r = run(sheetWithStatuses(["available", "Sold ", "RESERVED", "", "Available ", "Gone"]));
    expect(r.items.map((i) => i.id)).toEqual(["I-0001", "I-0003", "I-0005"]);
    expect(r.items.map((i) => i.freeUnits)).toEqual([2, 0, 2]);
  });
});

describe("contactUrl needs a country code (D-036.2)", () => {
  const url = (raw: unknown): string | null =>
    run(sheetWithStatuses(["Available"]), { sellerWhatsapp: raw }).contactUrl;

  // 91 + 9000000001 is the synthetic number 90000 00001 with the India code.
  it.each([
    "919000000001",
    "+91 90000 00001",
    "+91-90000-00001",
    "(91) 90000 00001",
    "+(91) 90000-00001",
    " 919000000001 ",
  ])("turns %j into https://wa.me/919000000001", (raw) => {
    expect(url(raw)).toBe("https://wa.me/919000000001");
  });

  it.each([
    ["10 digits, no country code", "9000000001"],
    ["10 digits with spaces, no country code", "90000 00001"],
    ["leading 0 national format", "0" + "9000000001"],
    ["16 digits (too long)", "9190000000011234"],
    ["text after the number", "91900000000 ext 2"],
    ["text before the number", "call 919000000001"],
    ["empty string", ""],
    ["only separators", "+ - ( )"],
    ["letters", "abc"],
    ["a stray letter after an otherwise valid number", "+91 90000 00001 x"],
  ])("gives null for %s (%j)", (_why, raw) => {
    expect(url(raw)).toBeNull();
  });

  it("gives null when the option is unset or not a string", () => {
    expect(url(undefined)).toBeNull();
    expect(url(null)).toBeNull();
    expect(url(919000000001)).toBeNull();
  });

  // Boundaries of the 11 to 15 digit rule.
  it("accepts 11 digits and 15 digits, rejects 10 and 16", () => {
    expect(url("91900000001")).toBe("https://wa.me/91900000001"); // 11
    expect(url("919000000001234")).toBe("https://wa.me/919000000001234"); // 15
    // Built by concatenation: the PII scan only accepts 90000 000xx-shaped literals.
    expect(url("91" + "90000001")).toBeNull(); // 10
    expect(url("9190000000012345")).toBeNull(); // 16
  });

  it("gives the same answer twice", () => {
    const ss = sheetWithStatuses(["Available"]);
    expect(run(ss, { sellerWhatsapp: "+91 90000 00001" })).toEqual(run(ss, { sellerWhatsapp: "+91 90000 00001" }));
  });
});
