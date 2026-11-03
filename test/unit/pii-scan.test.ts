import { describe, expect, it } from "vitest";
import { scanText, scanPaths } from "../../tools/pii-scan.mjs";

// Fixtures are assembled from pieces so this file does not itself trip the scan.
const rules = (text: string, file = "x.md") => scanText(file, text).map((f) => f.rule);

describe("phone numbers", () => {
  it("allows the synthetic +91 90000 000xx pattern", () => {
    expect(rules("call +91 90000 00012 or +919000000034 or 90000 00056")).toEqual([]);
  });

  it("flags a real-looking Indian number in several formats", () => {
    expect(rules("+91 90000" + " 00123")).toContain("phone");
    expect(rules("+91" + "90000" + "00124")).toContain("phone");
    expect(rules("900" + "00-00" + "125")).toContain("phone");
    expect(rules("90" + "00" + "000126")).toContain("phone");
  });

  it("flags E.164 numbers from other countries", () => {
    expect(rules("+44 77" + "00 900" + "123")).toContain("phone");
    expect(rules("+1 (415) " + "555-0123")).toContain("phone");
  });

  it("does not flag ordinary numbers, dates, versions or ids", () => {
    expect(rules("2026-11-03 v1.2.3 size 51200 bytes, 50 KB, T-12, S-01, 390 px")).toEqual([]);
    expect(rules("epoch 1730000000 ms 1730000000000")).toEqual([]);
  });

  it("does not print the matched value", () => {
    const f = scanText("x.md", "+91 90000" + " 00123")[0]!;
    expect(JSON.stringify(f)).not.toContain("00123");
    expect(f.line).toBe(1);
  });
});

describe("email addresses", () => {
  it("flags a normal address", () => {
    expect(rules("mail jane" + "@example.com")).toContain("email");
  });
  it("allows GitHub no-reply and the anthropic no-reply addresses", () => {
    expect(rules("1234+someone" + "@users.noreply.github.com")).toEqual([]);
    expect(rules("Co-Authored-By: Claude <noreply" + "@anthropic.com>")).toEqual([]);
  });
  it("does not allow look-alike addresses", () => {
    expect(rules("x" + "@evil-users.noreply.github.com.example.org")).toContain("email");
    expect(rules("other" + "@anthropic.com")).toContain("email");
  });
});

describe("Google Sheet links and IDs", () => {
  const id = "1" + "aB3_".repeat(10) + "xyz1"; // 44 chars
  it("has a 44-char fixture id", () => expect(id).toHaveLength(44));

  it("flags a spreadsheet URL", () => {
    expect(rules("https://docs.google" + ".com/spreadsheets/d/" + id + "/edit")).toContain("sheet");
    expect(rules("https://docs.google" + ".com/spreadsheets/")).toContain("sheet");
  });
  it("flags a bare 44-char id next to the word spreadsheets", () => {
    expect(rules("spreadsheets id: " + id)).toContain("sheet");
  });
  it("allows script.google.com deployment URLs (public by design)", () => {
    const url = "https://script.google" + ".com/macros/s/AKfycb" + "x".repeat(60) + "/exec";
    expect(rules(url)).toEqual([]);
  });
  it("does not flag the word spreadsheets in prose", () => {
    expect(rules("We use spreadsheets for the sale.")).toEqual([]);
  });
});

describe("tokens and secrets", () => {
  it.each([
    ["github token", "ghp_" + "a1B2c3D4e5".repeat(4)],
    ["fine-grained token", "github_pat_" + "A1b2C3d4E5".repeat(8)],
    ["aws key", "AKIA" + "ABCDEFGHIJKLMNOP"],
    ["google api key", "AIza" + "Sy" + "a1B2c3D4e5".repeat(3) + "abc"],
    ["private key", "-----BEGIN RSA " + "PRIVATE KEY-----"],
    ["slack token", "xoxb-" + "1234567890-abcdefghij"],
    ["assignment", 'api_key = "' + "abcd1234efgh5678ijkl" + '"'],
  ])("flags %s", (_n, text) => {
    expect(rules(text)).toContain("secret");
  });

  it("does not flag a short or placeholder assignment", () => {
    expect(rules('token = "abc"')).toEqual([]);
    expect(rules("Tokens go in POST bodies, never query strings")).toEqual([]);
  });
});

describe("tracked files", () => {
  it("flags anything under private/", () => {
    expect(scanPaths(["private/export.csv"]).map((f) => f.rule)).toContain("tracked-private");
  });
  it("flags .xlsx anywhere, any case", () => {
    expect(scanPaths(["docs/a.xlsx", "x/B.XLSX"]).length).toBe(2);
  });
  it("passes ordinary paths", () => {
    expect(scanPaths(["src/site/main.ts", "docs/private-notes.md", "test/fixtures/a.json"])).toEqual([]);
  });
});
