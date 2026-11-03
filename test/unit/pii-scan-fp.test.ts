import { describe, expect, it } from "vitest";
import { scanText } from "../../tools/pii-scan.mjs";

// Fixtures are assembled from pieces so this file does not itself trip the scan.
const rules = (text: string) => scanText("x.md", text).map((f) => f.rule);
const OPEN = "open" + "ById(";

describe("openById is flagged only for a string-literal argument", () => {
  it("flags single, double and backtick literals, with optional whitespace", () => {
    expect(rules("SpreadsheetApp." + OPEN + "'abc')")).toContain("sheet");
    expect(rules("SpreadsheetApp." + OPEN + '"abc")')).toContain("sheet");
    expect(rules("SpreadsheetApp." + OPEN + "`abc`)")).toContain("sheet");
    expect(rules("SpreadsheetApp." + OPEN + "  'abc')")).toContain("sheet");
  });
  it("passes an id read from script properties, or any variable", () => {
    expect(rules("SpreadsheetApp." + OPEN + "PropertiesService.getScriptProperties().getProperty('SHEET_ID'))")).toEqual([]);
    expect(rules("SpreadsheetApp." + OPEN + "id)")).toEqual([]);
    expect(rules("SpreadsheetApp." + OPEN + "\n  props.sheetId)")).toEqual([]);
  });
});

describe("bare id rule ignores camelCase and PascalCase code words", () => {
  const word = "handleReserveItemForUnitWithWaitingListEntry";
  it("passes long camelCase and PascalCase identifiers, even with a trailing digit", () => {
    for (const w of [word + "2", word + "42", "H" + word.slice(1) + "2", "testBackOutPromotesNextInQueueWhenUnit2IsFree"]) {
      expect(w.length, w).toBeGreaterThanOrEqual(40);
      expect(rules("function " + w + "() {}"), w).toEqual([]);
    }
  });
  it("still flags a real-looking sheet id", () => {
    const id = "1" + "aB3_".repeat(10) + "xyz";
    expect(id).toHaveLength(44);
    expect(rules('const SHEET = "' + id + '"')).toContain("sheet");
  });
  it("still flags separator-free random ids and camelCase-lookalikes with digits mid-word", () => {
    expect(rules("id " + "1aB3cD4eF5gH6i" + "J7kL8mN9oP0qR1sT2uV3wX4yZ5")).toContain("sheet");
    expect(rules("id " + "9Xk2QmW7vB3nLp5RtY8u" + "J4hGf6dSa1CzE0yNbV2x")).toContain("sheet");
  });
});
