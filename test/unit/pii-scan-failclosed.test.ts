import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { blockedWordsRequired, blockedWordsProblem } from "../../tools/pii-scan.mjs";

describe("fail closed when no blocked words are configured", () => {
  it("is required by the flag or by REQUIRE_BLOCKED_WORDS=1, otherwise not", () => {
    expect(blockedWordsRequired(["--require-blocked-words"], {})).toBe(true);
    expect(blockedWordsRequired([], { REQUIRE_BLOCKED_WORDS: "1" })).toBe(true);
    expect(blockedWordsRequired([], { REQUIRE_BLOCKED_WORDS: "" })).toBe(false);
    expect(blockedWordsRequired([], {})).toBe(false);
  });

  it("is a failure only when required and the list is empty", () => {
    expect(blockedWordsProblem([], true)).toEqual({ fail: true, message: expect.stringContaining("required") });
    expect(blockedWordsProblem([], false)).toEqual({ fail: false, message: expect.stringContaining("no blocked words") });
    expect(blockedWordsProblem(["zorblax"], true)).toBeNull();
    expect(blockedWordsProblem(["zorblax"], false)).toBeNull();
  });

  it("the CLI exits non-zero and says why when required and nothing is configured", () => {
    const r = spawnSync("node", ["tools/pii-scan.mjs", "--require-blocked-words"], {
      encoding: "utf8",
      env: { ...process.env, PII_BLOCKED_WORDS: "", PII_BLOCKED_WORDS_FILE: "/nonexistent/none.txt" },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("blocked words are required");
  });

  it("the CLI honours REQUIRE_BLOCKED_WORDS=1 too", () => {
    const r = spawnSync("node", ["tools/pii-scan.mjs"], {
      encoding: "utf8",
      env: { ...process.env, PII_BLOCKED_WORDS: "", PII_BLOCKED_WORDS_FILE: "/nonexistent/none.txt", REQUIRE_BLOCKED_WORDS: "1" },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("blocked words are required");
  });
});
