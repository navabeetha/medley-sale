import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkBudgets, BUDGETS } from "../../tools/size-budget.mjs";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "budget-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (rel: string, data: string | Buffer) => {
  const full = join(dir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, data);
};

describe("size budget", () => {
  it("uses the documented limits", () => {
    expect(BUDGETS).toEqual({ codeGzip: 50 * 1024, thumb: 12 * 1024, photo: 120 * 1024 });
  });

  it("passes for a small site with no photos", () => {
    put("index.html", "<!doctype html><title>x</title>");
    put("main.js", "console.log(1)");
    put("style.css", "body{margin:0}");
    const r = checkBudgets(dir);
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.codeGzipBytes).toBeGreaterThan(0);
  });

  it("fails when gzipped HTML+CSS+JS exceeds 50 KB in total", () => {
    // Random hex does not compress below ~50%, so 120 KB of it exceeds 50 KB gzipped.
    put("main.js", randomBytes(60_000).toString("hex"));
    const r = checkBudgets(dir);
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toMatch(/HTML\+CSS\+JS/);
  });

  it("sums the three file types rather than checking each alone", () => {
    for (const f of ["a.js", "b.css", "c.html"]) put(f, randomBytes(10_000).toString("hex"));
    // ~10 KB gzip each of 20 KB hex => about 30 KB total: passes.
    expect(checkBudgets(dir).ok).toBe(true);
    for (const f of ["d.js", "e.css"]) put(f, randomBytes(12_000).toString("hex"));
    expect(checkBudgets(dir).ok).toBe(false);
  });

  it("ignores photos when summing code, and non-code files", () => {
    put("main.js", "x");
    put("photos/big.webp", randomBytes(50_000));
    put("data.json", randomBytes(80_000).toString("hex"));
    const r = checkBudgets(dir);
    expect(r.problems.some((p) => /HTML\+CSS\+JS/.test(p))).toBe(false);
  });

  it("fails a thumbnail over 12 KB and passes one at the limit", () => {
    put("photos/thumb-a.webp", randomBytes(12 * 1024));
    expect(checkBudgets(dir).ok).toBe(true);
    put("photos/thumb-b.webp", randomBytes(12 * 1024 + 1));
    const r = checkBudgets(dir);
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toContain("thumb-b.webp");
  });

  it("fails a full photo over 120 KB and passes one at the limit", () => {
    put("photos/a.webp", randomBytes(120 * 1024));
    expect(checkBudgets(dir).ok).toBe(true);
    put("photos/b.webp", randomBytes(120 * 1024 + 1));
    const r = checkBudgets(dir);
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toContain("b.webp");
  });

  it("passes when the directory has no photos folder", () => {
    put("index.html", "<p>hi</p>");
    expect(checkBudgets(dir).ok).toBe(true);
  });
});
