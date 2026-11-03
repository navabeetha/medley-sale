import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const deploy = readFileSync(".github/workflows/deploy.yml", "utf8");
const both: [string, string][] = [["ci.yml", ci], ["deploy.yml", deploy]];

// Uncommented lines only, so a note in a comment cannot satisfy an assertion.
const code = (t: string) => t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

describe("workflow guard settings", () => {
  it("deploy always requires blocked words", () => {
    expect(code(deploy)).toMatch(/^\s*REQUIRE_BLOCKED_WORDS:\s*"1"\s*$/m);
  });
  it("ci requires blocked words on push events only", () => {
    expect(code(ci)).toMatch(/^\s*REQUIRE_BLOCKED_WORDS:\s*\$\{\{\s*github\.event_name == 'push' && '1' \|\| ''\s*\}\}\s*$/m);
  });
  it.each(both)("%s checks out full history", (_n, t) => {
    expect(code(t)).toMatch(/actions\/checkout@[^\n]*\n\s*with:\n\s*fetch-depth:\s*0\b/);
  });
  it.each(both)("%s runs npm run check", (_n, t) => {
    expect(code(t)).toMatch(/^\s*- run: npm run check\s*$/m);
  });
  it.each(both)("%s takes PII_BLOCKED_WORDS from secrets", (_n, t) => {
    expect(code(t)).toMatch(/^\s*PII_BLOCKED_WORDS:\s*\$\{\{\s*secrets\.PII_BLOCKED_WORDS\s*\}\}\s*$/m);
  });
  it("deploy does not carry a stale pre-G0 warning (G0.1 is done)", () => {
    expect(deploy).not.toMatch(/do not enable before/i);
  });
});
