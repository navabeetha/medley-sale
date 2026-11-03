import { describe, expect, it } from "vitest";
import { applyHistoryAllowlist } from "../../tools/pii-scan.mjs";

const f = (file: string, rule: string) => ({ file, line: 0, rule });

describe("history allowlist (known-fictional fixtures in already-written commits)", () => {
  const text = "# why\n\ncommit abc1234 test/a.test.ts phone\n";
  it("drops only the exact commit, file and rule", () => {
    const kept = applyHistoryAllowlist([
      f("commit abc1234 test/a.test.ts", "phone"),
      f("commit abc1234 test/a.test.ts", "email"),
      f("commit abc1234 test/b.test.ts", "phone"),
      f("commit def5678 test/a.test.ts", "phone"),
      f("test/a.test.ts", "phone"),
    ], text);
    expect(kept.map((x: { file: string; rule: string }) => `${x.file} ${x.rule}`)).toEqual([
      "commit abc1234 test/a.test.ts email",
      "commit abc1234 test/b.test.ts phone",
      "commit def5678 test/a.test.ts phone",
      "test/a.test.ts phone",
    ]);
  });
  it("an empty or missing list keeps everything", () => {
    expect(applyHistoryAllowlist([f("commit abc1234 x", "phone")], "")).toHaveLength(1);
  });
});
