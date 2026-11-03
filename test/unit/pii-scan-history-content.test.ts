import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { scanPatchLog, scanRevisions } from "../../tools/pii-scan.mjs";

// Fixtures are assembled from pieces so this file does not itself trip the scan.
const ZERO = "0".repeat(40);
const PHONE = "+91 90000" + " 00133"; // fictional, outside the allowed 000xx series
const GOOD_EMAIL = "1+dev" + "@users.noreply.github.com";
const SHA = "a1b2c3d" + "e".repeat(33);

const patch = (file: string, added: string[]) =>
  `\x1e${SHA}\ndiff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${added.length} @@\n` +
  added.map((l) => "+" + l).join("\n") + "\n";

describe("scanPatchLog (pure)", () => {
  it("flags added lines, naming commit and file but never the value", () => {
    const f = scanPatchLog(patch("notes.md", ["call " + PHONE]), [])[0]!;
    expect(f.rule).toBe("phone");
    expect(f.file).toContain("a1b2c3d");
    expect(f.file).toContain("notes.md");
    expect(JSON.stringify(f)).not.toContain("00133");
  });
  it("ignores removed and context lines", () => {
    const text = `\x1e${SHA}\ndiff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-call ${PHONE}\n+call nobody\n`;
    expect(scanPatchLog(text, [])).toEqual([]);
  });
  it("skips package-lock.json content", () => {
    expect(scanPatchLog(patch("package-lock.json", ["call " + PHONE]), [])).toEqual([]);
  });
  it("treats an added line that looks like a file header as content", () => {
    expect(scanPatchLog(patch("a.md", ["++ b/package-lock.json", PHONE]), []).map((f) => f.rule)).toEqual(["phone"]);
  });
  it("flags blocked words in added lines", () => {
    expect(scanPatchLog(patch("a.md", ["for Zorblax"]), ["zorblax"]).map((f) => f.rule)).toEqual(["blocked-word"]);
  });
});

describe("history content against a throwaway repo", () => {
  const root = resolve(".");
  let dir = "";
  const env = {
    ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "Dev", GIT_AUTHOR_EMAIL: GOOD_EMAIL, GIT_COMMITTER_NAME: "Dev", GIT_COMMITTER_EMAIL: GOOD_EMAIL,
    PII_BLOCKED_WORDS: "zorblax", PII_BLOCKED_WORDS_FILE: "/nonexistent/none.txt",
  };
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, env, encoding: "utf8" }).trim();
  const run = (script: string, args: string[], input?: string) =>
    spawnSync("node", [join(root, script), ...args], { cwd: dir, env, input, encoding: "utf8" });
  const commitFile = (name: string, body: string, msg: string) => {
    writeFileSync(join(dir, name), body);
    git("add", name);
    git("commit", "-q", "-m", msg);
    return git("rev-parse", "HEAD");
  };

  let first = "", added = "", deleted = "";
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "histcontent-"));
    git("init", "-q", "-b", "main");
    first = commitFile("a.txt", "fine\n", "S-01: fine");
    added = commitFile("fixture.txt", "call " + PHONE + "\n", "S-01: add fixture");
    git("rm", "-q", "fixture.txt");
    git("commit", "-q", "-m", "S-01: remove fixture");
    deleted = git("rev-parse", "HEAD");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("the working tree and every message are clean, yet the added-then-deleted number is found in history", () => {
    const f = scanRevisions([`${first}..${deleted}`], [], dir);
    expect(f.map((x: { rule: string }) => x.rule)).toEqual(["phone"]);
    expect(f[0]!.file).toContain(added.slice(0, 7));
    expect(f[0]!.file).toContain("fixture.txt");
    expect(JSON.stringify(f)).not.toContain("00133");
  });

  it("pre-push refuses the add-then-delete push (new branch and update)", () => {
    const fresh = run("tools/pre-push.mjs", ["--require-blocked-words"], `refs/heads/main ${deleted} refs/heads/main ${ZERO}\n`);
    expect(fresh.status).toBe(1);
    expect(fresh.stderr).toMatch(/commit .*fixture\.txt.*phone/);
    expect(fresh.stderr).not.toContain("00133");
    const upd = run("tools/pre-push.mjs", [], `refs/heads/main ${deleted} refs/heads/main ${first}\n`);
    expect(upd.status).toBe(1);
  });

  it("pre-push scans by SHA from another branch, not the checked-out tree", () => {
    git("checkout", "-q", "-b", "other", first);
    const r = run("tools/pre-push.mjs", [], `refs/heads/main ${deleted} refs/heads/main ${first}\n`);
    expect(r.status).toBe(1);
    git("checkout", "-q", "main");
  });

  it("pre-push allows a range that excludes the bad commits", () => {
    const r = run("tools/pre-push.mjs", [], `refs/heads/main ${first} refs/heads/main ${first}\n`);
    expect(r.status).toBe(0);
  });

  it("flags added paths such as a tracked csv even when the file is later deleted", () => {
    const sha = commitFile("export.csv", "a,b\n", "S-01: add export");
    git("rm", "-q", "export.csv");
    git("commit", "-q", "-m", "S-01: drop export");
    const f = scanRevisions([`${deleted}..HEAD`], [], dir);
    expect(f.map((x: { rule: string }) => x.rule)).toEqual(["tracked-export"]);
    expect(f[0]!.file).toContain(sha.slice(0, 7));
  });

  it("pii-scan history mode (CLI) finds the deleted number in any commit reachable from HEAD", () => {
    const r = run("tools/pii-scan.mjs", []);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/commit .*fixture\.txt.*phone/);
    expect(r.stderr).not.toContain("00133");
  });
});
