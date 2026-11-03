import { describe, expect, it } from "vitest";
import { scanText, scanPaths } from "../../tools/pii-scan.mjs";

// Fixtures are assembled from pieces so this file does not itself trip the scan.
const rules = (text: string) => scanText("x.md", text).map((f) => f.rule);

describe("more tracked-file path rules", () => {
  it.each([
    [".clasp.json", "tracked-clasp"],
    ["src/appscript/.clasp.json", "tracked-clasp"],
    [".env", "tracked-env"],
    ["app/.env.local", "tracked-env"],
    ["export.csv", "tracked-export"],
    ["docs/Data.CSV", "tracked-export"],
    ["a/b.ods", "tracked-export"],
    ["a/b.xls", "tracked-export"],
  ])("flags %s", (path, rule) => {
    expect(scanPaths([path]).map((f) => f.rule)).toContain(rule);
  });
  it("passes look-alikes", () => {
    expect(scanPaths(["docs/env.md", "src/clasp.json.d.ts", "a/b.csvx", "tools/environment.ts", ".clasprc.example.md"])).toEqual([]);
  });
});

describe("secret-style keys with underscores", () => {
  const v = "abcd1234" + "efgh5678";
  it.each(["refresh_token", "access_token", "my_token", "app_secret", "client_secret", "CLIENT_SECRET"])("flags %s", (k) => {
    expect(rules(k + ' = "' + v + '"')).toContain("secret");
    expect(rules('"' + k + '": "' + v + '"')).toContain("secret");
  });
  it("flags GOCSPX client secrets", () => {
    expect(rules("GOC" + "SPX-" + "aB3dE6gH9jK2mN5pQ8sT1vW4xY7")).toContain("secret");
  });
  it("still ignores short values", () => {
    expect(rules('refresh_token = "abc"')).toEqual([]);
  });
});

describe("booking URLs carry a bearer token", () => {
  it("flags a #/b/<token> link with 16+ url-safe chars", () => {
    expect(rules("https://example.org/#/" + "b/" + "Ab3_dE6-gH9jK2mN5pQ8")).toContain("secret");
    expect(rules("#/" + "b/" + "x".repeat(16))).toContain("secret");
  });
  it("ignores short or placeholder routes", () => {
    expect(rules("#/" + "b/abc")).toEqual([]);
    expect(rules("#/" + "b/<token>")).toEqual([]);
    expect(rules("#/" + "b/" + "x".repeat(15))).toEqual([]);
  });
});

describe("phone number shapes seen in the wild", () => {
  it("flags 0091 prefixed numbers with dot or slash separators", () => {
    expect(rules("0091 90000 " + "00127")).toContain("phone");
    expect(rules("0091" + "90000" + "00128")).toContain("phone");
    expect(rules("90000." + "00129")).toContain("phone");
    expect(rules("+91.90000." + "00130")).toContain("phone");
    expect(rules("90000/" + "00131")).toContain("phone");
    expect(rules("0091/90000/" + "00132")).toContain("phone");
  });
  it("allows the synthetic pattern in the same shapes", () => {
    expect(rules("0091 90000 " + "00012 and 90000.00013 and 90000/00014")).toEqual([]);
  });
  it("does not flag dotted versions, ips, dates or paths", () => {
    expect(rules("v10.20.30 192.168.1.100 2026.11.03 src/domain/queue.ts 12/05/2026")).toEqual([]);
  });
});

describe("percent-encoded addresses", () => {
  it("flags a mailto with %40", () => {
    expect(rules("mailto:jane" + "%40example.com")).toContain("email");
    expect(rules("jane.doe" + "%40" + "example.com?subject=x")).toContain("email");
  });
  it("allows the allowlisted no-reply addresses in encoded form", () => {
    expect(rules("noreply" + "%40anthropic.com")).toEqual([]);
  });
  it("accepts noreply@github.com (merge commits made by GitHub)", () => {
    expect(rules("GitHub <noreply" + "@github.com>")).toEqual([]);
  });
});
