import { describe, expect, it } from "vitest";
import { scanText } from "../../tools/pii-scan.mjs";

// Fixtures are assembled from pieces so this file does not itself trip the scan.
const rules = (text: string) => scanText("x.md", text).map((f) => f.rule);

// Mixed-case id with digits, padded to an exact length.
const mixed = (n: number) => ("Ab1_" + "xY9-".repeat(20)).slice(0, n);

describe("Apps Script, Drive and Docs links", () => {
  it("flags openById calls", () => {
    expect(rules("SpreadsheetApp." + "open" + "ById('id')")).toContain("sheet");
  });
  it("flags drive links", () => {
    expect(rules("https://drive.google" + ".com/file/d/abc/view")).toContain("sheet");
  });
  it.each(["document", "forms", "presentation", "file"])("flags docs.google.com/%s", (kind) => {
    expect(rules("https://docs.google" + ".com/" + kind + "/d/abc/edit")).toContain("sheet");
  });
  it("does not flag plain docs.google.com mentions of other paths", () => {
    expect(rules("see docs.google" + ".com/about")).toEqual([]);
  });
});

describe("bare 40-50 char ids with upper, lower and digits", () => {
  it("flags the boundaries 40 and 50", () => {
    expect(rules("id " + mixed(40))).toContain("sheet");
    expect(rules("id=" + mixed(50))).toContain("sheet");
    expect(rules('"' + mixed(44) + '"')).toContain("sheet");
  });
  it("does not flag 39 or 51 char runs", () => {
    expect(rules("id " + mixed(39))).toEqual([]);
    expect(rules("id " + mixed(51))).toEqual([]);
  });
  it("needs all of upper, lower and a digit", () => {
    expect(rules("id " + mixed(44).toLowerCase())).toEqual([]);
    expect(rules("id " + mixed(44).toUpperCase())).toEqual([]);
    expect(rules("id " + mixed(44).replace(/\d/g, "q"))).toEqual([]);
  });
  it("does not flag hex digests, git SHAs or long base64", () => {
    expect(rules("sha256 " + "0123456789abcdef".repeat(4))).toEqual([]);
    expect(rules("commit " + "0123456789abcdef".repeat(3).slice(0, 40))).toEqual([]);
    expect(rules("integrity sha512-" + "Ab1+".repeat(22) + "==")).toEqual([]);
    expect(rules("data " + "Ab1/".repeat(30))).toEqual([]);
  });
  it("does not flag prose or ordinary long identifiers", () => {
    expect(rules("handleReservationWaitingListBackOutRequest")).toEqual([]);
  });
  it("still allows a ~72 char script deployment id in a macros URL", () => {
    const dep = "AKfycb" + mixed(66).slice(0, 66);
    expect(dep).toHaveLength(72);
    expect(rules("https://script.google" + ".com/macros/s/" + dep + "/exec")).toEqual([]);
  });
});
