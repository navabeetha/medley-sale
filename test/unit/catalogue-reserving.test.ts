// S-11 / D-038 rule 6: the catalogue response gains a top-level `reserving` flag.
//
// DESIGNED CHANGE to src/api/catalogue.ts:
//   catalogue(...) returns { items, contactUrl, reserving }
//   reserving === true  exactly when the spreadsheet has a tab named "Claims"
//                       (engine mode: the build copy now, the real sheet after G2)
//   reserving === false otherwise (status mode, R1). Always a boolean, never absent.
//
// The site reads this to switch between R1 browse-only and the reserving UI, so
// the flag follows the TAB, not the tab's contents: an empty Claims tab (header
// row only) still means reserving.
//
// Existing tests deliberately updated for this: the key-list assertion in
// test/unit/catalogue-status-mode.test.ts ("is a sibling of items on the
// response") now expects ["contactUrl", "items", "reserving"].
import { describe, expect, it } from "vitest";
import { catalogue } from "../../src/api/catalogue";
import { FakeSpreadsheet } from "../fixtures/fake-sheet";

const HEAD = ["Item", "Brand", "Category", "Price", "Available from", "Status", "Person", "Notes", "Photo", "ID", "Quantity"];

function sheet(claims: "rows" | "headers-only" | "wrong-headers" | "none"): FakeSpreadsheet {
  const ss = new FakeSpreadsheet("Synthetic sale");
  ss.withTab("Tech", [
    ["Synthetic title row"],
    HEAD,
    ["Echo Dot", "Zorbo", "Cat", 100, "Now", "Available", null, null, null, "I-0001", 1],
  ]);
  if (claims === "rows") {
    ss.withTab("Claims", [["Claim ID", "Booking ID", "Item ID", "State"], [1, "BK-1", "I-0001", "active"]]);
  } else if (claims === "headers-only") {
    ss.withTab("Claims", [["Claim ID", "Booking ID", "Item ID", "State"]]);
  } else if (claims === "wrong-headers") {
    ss.withTab("Claims", [["Something else"]]);
  }
  return ss;
}

describe("catalogue: reserving flag (D-038 rule 6)", () => {
  it("is true when a Claims tab exists", () => {
    expect(catalogue(sheet("rows")).reserving).toBe(true);
  });

  it("is true for an empty Claims tab with only its header row", () => {
    expect(catalogue(sheet("headers-only")).reserving).toBe(true);
  });

  it("follows the tab, not its contents: true even when the Claims headers are unrecognisable", () => {
    expect(catalogue(sheet("wrong-headers")).reserving).toBe(true);
  });

  it("is false (not missing) when there is no Claims tab", () => {
    const r = catalogue(sheet("none"));
    expect(r.reserving).toBe(false);
    expect(Object.keys(r)).toContain("reserving");
  });

  it("is not fooled by a Bookings tab alone", () => {
    const ss = sheet("none");
    ss.withTab("Bookings", [["Booking ID", "Token"]]);
    expect(catalogue(ss).reserving).toBe(false);
  });

  it("matches the Claims tab name exactly (a lookalike tab does not switch reserving on)", () => {
    const ss = sheet("none");
    ss.withTab("Claims (old)", [["Claim ID"]]);
    expect(catalogue(ss).reserving).toBe(false);
  });

  it("is a sibling of items and contactUrl and adds no other top-level key", () => {
    expect(Object.keys(catalogue(sheet("rows"))).sort()).toEqual(["contactUrl", "items", "reserving"]);
  });

  it("survives JSON as a real boolean", () => {
    const json = JSON.parse(JSON.stringify(catalogue(sheet("rows")))) as { reserving: unknown };
    expect(json.reserving).toBe(true);
  });
});
