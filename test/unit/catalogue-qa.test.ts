// S-04 QA follow-ups (docs/qa/qa-log.md, 2026-11-05): F1 dates, F4 tab allow-list, F5 gaps.
// F1: `availableFrom` is a plain calendar date "YYYY-MM-DD" in the spreadsheet's time zone.
//   catalogue(ss, { formatDate?: (d: Date) => string }) -- the adapter injects
//   Utilities.formatDate(d, tz, "yyyy-MM-dd"); the default is the UTC calendar date of the instant.
// Synthetic data only.
import { describe, expect, it } from "vitest";
import { catalogue } from "../../src/api/catalogue";
import type { CellValue } from "../../src/api/sheet";
import { FakeSpreadsheet, type FakeTab } from "../fixtures/fake-sheet";

type Opts = { photoCounts?: Record<string, number>; formatDate?: (d: Date) => string };
type Item = Record<string, unknown> & { id: string; name: string; tab: string };
const run = (ss: FakeSpreadsheet, opts?: Opts): Item[] =>
  (catalogue(ss, opts as never) as unknown as { items: Item[] }).items;


const CLAIM_HEADERS = ["Claim ID", "Booking ID", "Item ID", "State"];
/**
 * These QA tests are about behaviour that does not depend on the mode (dates,
 * allow-list, gaps) and were written for the queue engine. Without a Claims tab
 * the catalogue is in status mode (D-035) and would hide rows with no Status, so
 * the fixtures get an empty Claims tab to stay in engine mode.
 */
const engineSheet = (): FakeSpreadsheet => {
  const ss = new FakeSpreadsheet("Synthetic sale");
  ss.withTab("Claims", [[...CLAIM_HEADERS]]);
  return ss;
};

const HEADERS = ["Item", "Brand", "Price", "Available from", "Status", "Person", "Notes", "ID", "Quantity"];

/** Rows go in under `headers`, with `above` filler rows over the header row. */
function tab(
  ss: FakeSpreadsheet, name: string, rows: Record<string, CellValue>[],
  { headers = HEADERS, above = 1 }: { headers?: string[]; above?: number } = {},
): FakeTab {
  return ss.withTab(name, [
    ...Array.from({ length: above }, (_, i) => [`title ${i + 1}`]),
    [...headers],
    ...rows.map((r) => headers.map((h) => r[h.trim()] ?? null)),
  ]);
}
const one = (id: string, item: string, extra: Record<string, CellValue> = {}): Record<string, CellValue> => ({
  Item: item, Brand: "BrandX", Price: 10, "Available from": "Now", ID: id, Quantity: 1, ...extra,
});

// ---- F1: dates in the spreadsheet's time zone

// 2 Dec 2026 00:00 in Asia/Kolkata (UTC+05:30) is 1 Dec 18:30 UTC. This is what Apps Script
// hands over for a date cell on a sheet set to IST; toISOString() would say 2026-12-01.
const IST_MIDNIGHT = new Date("2026-12-01T18:30:00Z");
/** Calendar date in IST, computed by hand: shift the instant by +5:30 and read the UTC date. */
const istFormat = (d: Date): string => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

describe("catalogue dates: calendar date in the spreadsheet's time zone (QA F1)", () => {
  const withDate = (v: CellValue) => {
    const ss = engineSheet();
    tab(ss, "Tech", [one("I-0001", "Echo Dot", { "Available from": v })]);
    return ss;
  };

  it("gives exactly 2026-12-02 for IST midnight when the IST formatter is injected", () => {
    expect(run(withDate(IST_MIDNIGHT), { formatDate: istFormat })[0]!.availableFrom).toBe("2026-12-02");
  });

  it("gives the same 2026-12-02 in status mode (no Claims tab, Status Available)", () => {
    const ss = new FakeSpreadsheet("Synthetic sale");
    tab(ss, "Tech", [one("I-0001", "Echo Dot", { "Available from": IST_MIDNIGHT, Status: "Available" })]);
    expect(run(ss, { formatDate: istFormat })[0]!.availableFrom).toBe("2026-12-02");
  });

  it("passes the date cell's instant to the injected formatter", () => {
    const seen: number[] = [];
    run(withDate(IST_MIDNIGHT), { formatDate: (d) => { seen.push(d.getTime()); return "2000-01-01"; } });
    expect(seen).toEqual([IST_MIDNIGHT.getTime()]);
  });

  it("returns whatever the formatter returns, and never a time part", () => {
    const from = run(withDate(IST_MIDNIGHT), { formatDate: istFormat })[0]!.availableFrom;
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("defaults to the UTC calendar date of the instant when no formatter is injected", () => {
    // Without a formatter the IST-midnight instant reads as 1 Dec in UTC: the default is simple, the adapter must inject.
    expect(run(withDate(IST_MIDNIGHT))[0]!.availableFrom).toBe("2026-12-01");
    expect(run(withDate(new Date(Date.UTC(2026, 11, 2))))[0]!.availableFrom).toBe("2026-12-02");
  });

  it("output is a bare YYYY-MM-DD even for a UTC date with a time of day", () => {
    expect(run(withDate(new Date("2026-12-02T23:59:59.999Z")))[0]!.availableFrom).toBe("2026-12-02");
  });

  it("still passes text such as 'Now' through, formatter or not, and never calls the formatter for it", () => {
    let calls = 0;
    const formatDate = () => { calls++; return "x"; };
    expect(run(withDate("Now"), { formatDate })[0]!.availableFrom).toBe("Now");
    expect(run(withDate("Now"))[0]!.availableFrom).toBe("Now");
    expect(calls).toBe(0);
  });

  it("still gives null for a blank cell, and does not call the formatter", () => {
    let calls = 0;
    expect(run(withDate(null), { formatDate: () => { calls++; return "x"; } })[0]!.availableFrom).toBeNull();
    expect(calls).toBe(0);
  });

  it("gives null for an invalid Date rather than 'Invalid Date' or a throw", () => {
    expect(run(withDate(new Date("nonsense")), { formatDate: istFormat })[0]!.availableFrom).toBeNull();
  });
});

// ---- F4: only the four item tabs are published

describe("catalogue tab allow-list (QA F4)", () => {
  const sheet = () => {
    const ss = engineSheet();
    tab(ss, "Tech", [one("I-0001", "Echo Dot")]);
    tab(ss, "Gym & Sport", [one("I-0002", "Yoga mat")]);
    tab(ss, "Home Things", [one("I-0003", "Picture frame")]);
    tab(ss, "Books", [{ Item: "Tiny Atlas", Price: 5, ID: "I-0004", Quantity: 1 }]);
    return ss;
  };

  it.each(["Copy of Template", "Garden", "Copy of Tech", "tech", "Archive"])("does not publish an item-shaped tab named %j", (name) => {
    const ss = sheet();
    tab(ss, name, [one("I-0099", "Hidden Thing")]);
    const names = run(ss).map((i) => i.name);
    expect(names).not.toContain("Hidden Thing");
    expect(names).toEqual(["Echo Dot", "Yoga mat", "Picture frame", "Tiny Atlas"]);
  });

  it("still publishes all four allowed tabs", () => {
    expect(run(sheet()).map((i) => i.tab)).toEqual(["Tech", "Gym & Sport", "Home Things", "Books"]);
  });
});

// ---- F5: gaps found by the mutation run

describe("catalogue edge cases (QA F5)", () => {
  const link = (ss: FakeSpreadsheet, t: FakeTab, url: string) => { void ss; t.setLink(3, 2, url); };

  it("uses the first http(s) link when a cell carries several", () => {
    const ss = engineSheet();
    const t = tab(ss, "Tech", [one("I-0001", "Echo Dot")]);
    link(ss, t, "https://example.invalid/a https://example.invalid/b");
    expect(run(ss)[0]!.link).toBe("https://example.invalid/a");
  });

  it("gives null when the first of several links is not http(s)", () => {
    const ss = engineSheet();
    const t = tab(ss, "Tech", [one("I-0001", "Echo Dot")]);
    link(ss, t, "javascript:alert(1) https://example.invalid/b");
    expect(run(ss)[0]!.link).toBeNull();
  });

  it.each([1, 3])("reads a tab whose header is on row %i", (headerRow) => {
    const ss = engineSheet();
    tab(ss, "Tech", [one("I-0001", "Echo Dot", { Price: 2500 })], { above: headerRow - 1 });
    expect(run(ss)).toHaveLength(1);
    expect(run(ss)[0]).toMatchObject({ name: "Echo Dot", price: 2500 });
  });

  it("finds headers with stray spaces around them", () => {
    const ss = engineSheet();
    tab(ss, "Tech", [one("I-0001", "Echo Dot", { Price: 2500, Notes: "ok" })], {
      headers: HEADERS.map((h) => ` ${h} `),
    });
    expect(run(ss)[0]).toMatchObject({ name: "Echo Dot", price: 2500, notes: "ok", quantity: 1 });
  });

  it.each(["100 rs", "Ask", "1,000"])("gives a null price for the text %j", (text) => {
    const ss = engineSheet();
    tab(ss, "Tech", [one("I-0001", "Echo Dot", { Price: text })]);
    expect(run(ss)[0]!.price).toBeNull();
  });

  it("hides an item whose Quantity is text, even a numeric-looking one (Quantity must be a number)", () => {
    const ss = engineSheet();
    tab(ss, "Tech", [one("I-0001", "Echo Dot", { Quantity: "2" })]);
    expect(run(ss)).toEqual([]);
  });

  it("ignores a Claims row whose State is junk, so it neither sells nor queues the item", () => {
    const ss = new FakeSpreadsheet("Synthetic sale");
    tab(ss, "Tech", [one("I-0001", "Echo Dot")]);
    ss.withTab("Claims", [
      ["Claim ID", "Item ID", "State"],
      [1, "I-0001", "banana"],
    ]);
    expect(run(ss)[0]).toMatchObject({ unitsLeft: 1, freeUnits: 1, waitingCount: 0 });
  });
});
