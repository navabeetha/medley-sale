import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { scanPatchLog, scanRevisions } from "../../tools/pii-scan.mjs";

// Fixtures are assembled from pieces so this file does not itself trip the scan.
const PHONE = "+91 90000" + " 00133"; // fictional, outside the allowed 000xx series
const GOOD_EMAIL = "1+dev" + "@users.noreply.github.com";
const SHA = "a1b2c3d" + "e".repeat(33);

type F = { rule: string; file: string };

describe("scanPatchLog file boundaries (pure)", () => {
  const two = (second: string, firstBody: string[], secondBody: string[]) =>
    `\x1e${SHA}\ndiff --git a/a.md b/a.md\nnew file mode 100644\n--- /dev/null\n+++ b/a.md\n@@ -0,0 +1,${firstBody.length} @@\n` +
    firstBody.map((l) => "+" + l).join("\n") +
    `\ndiff --git a/${second} b/${second}\nnew file mode 100644\n--- /dev/null\n+++ b/${second}\n@@ -0,0 +1,${secondBody.length} @@\n` +
    secondBody.map((l) => "+" + l).join("\n") + "\n";

  it("attributes added lines to the file whose hunk they are in, not the next file", () => {
    const f = scanPatchLog(two("b.md", ["call " + PHONE], ["fine"]), []) as F[];
    expect(f).toHaveLength(1);
    expect(f[0]!.file).toContain("a.md");
    expect(f[0]!.file).not.toContain("b.md");
  });
  it("a file sorting just before package-lock.json is still scanned, the lockfile is not", () => {
    const f = scanPatchLog(two("package-lock.json", ["call " + PHONE], ["call " + PHONE]), []) as F[];
    expect(f).toHaveLength(1);
    expect(f[0]!.file).toContain("a.md");
    const g = scanPatchLog(two("sub/package-lock.json", ["fine"], ["call " + PHONE]), []) as F[];
    expect(g).toEqual([]);
  });
});

describe("merge commits and git errors against throwaway repos", () => {
  const root = resolve(".");
  const dirs: string[] = [];
  const envFor = () => ({
    ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "Dev", GIT_AUTHOR_EMAIL: GOOD_EMAIL, GIT_COMMITTER_NAME: "Dev", GIT_COMMITTER_EMAIL: GOOD_EMAIL,
    PII_BLOCKED_WORDS: "zorblax", PII_BLOCKED_WORDS_FILE: "/nonexistent/none.txt",
  });
  const mk = () => {
    const dir = mkdtempSync(join(tmpdir(), "histmerge-"));
    dirs.push(dir);
    const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, env: envFor(), encoding: "utf8" }).trim();
    const put = (name: string, body: string) => {
      mkdirSync(join(dir, name, ".."), { recursive: true });
      writeFileSync(join(dir, name), body);
    };
    const commit = (name: string, body: string, msg: string) => {
      put(name, body);
      git("add", name);
      git("commit", "-q", "-m", msg);
      return git("rev-parse", "HEAD");
    };
    const run = (script: string, args: string[], input?: string) =>
      spawnSync("node", [join(root, script), ...args], { cwd: dir, env: envFor(), input, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    return { dir, git, put, commit, run };
  };
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  describe("(a) side branch adds then deletes, merged --no-ff", () => {
    let r: ReturnType<typeof mk>, base = "", head = "", added = "";
    beforeAll(() => {
      r = mk();
      base = r.commit("a.txt", "fine\n", "S-01: base");
      r.git("checkout", "-q", "-b", "side");
      added = r.commit("fixture.txt", "call " + PHONE + "\n", "S-01: side add");
      r.git("rm", "-q", "fixture.txt");
      r.git("commit", "-q", "-m", "S-01: side remove");
      r.git("checkout", "-q", "main");
      r.git("merge", "-q", "--no-ff", "-m", "S-01: merge side", "side");
      head = r.git("rev-parse", "HEAD");
    });
    it("scanRevisions finds the number in the side commit", () => {
      const f = scanRevisions([`${base}..${head}`], [], r.dir) as F[];
      expect(f.map((x) => x.rule)).toEqual(["phone"]);
      expect(f[0]!.file).toContain(added.slice(0, 7));
    });
    it("pre-push refuses it", () => {
      const p = r.run("tools/pre-push.mjs", [], `refs/heads/main ${head} refs/heads/main ${base}\n`);
      expect(p.status).toBe(1);
      expect(p.stderr).toMatch(/commit .*fixture\.txt.*phone/);
      expect(p.stderr).not.toContain("00133");
    });
  });

  describe("(b) evil merge introduces content, next commit deletes it", () => {
    let r: ReturnType<typeof mk>, base = "", head = "", merge = "";
    beforeAll(() => {
      r = mk();
      base = r.commit("a.txt", "fine\n", "S-01: base");
      r.git("checkout", "-q", "-b", "side");
      r.commit("s.txt", "side\n", "S-01: side work");
      r.git("checkout", "-q", "main");
      r.commit("m.txt", "main\n", "S-01: main work");
      r.git("merge", "-q", "--no-ff", "--no-commit", "side");
      r.put("evil.txt", "call " + PHONE + "\n");
      r.git("add", "evil.txt");
      r.git("commit", "-q", "-m", "S-01: merge side");
      merge = r.git("rev-parse", "HEAD");
      r.git("rm", "-q", "evil.txt");
      r.git("commit", "-q", "-m", "S-01: tidy");
      head = r.git("rev-parse", "HEAD");
    });
    it("scanRevisions finds the number in the merge commit", () => {
      const f = scanRevisions([`${base}..${head}`], [], r.dir) as F[];
      expect(f.map((x) => x.rule)).toEqual(["phone"]);
      expect(f[0]!.file).toContain(merge.slice(0, 7));
      expect(f[0]!.file).toContain("evil.txt");
    });
    it("pre-push refuses it", () => {
      const p = r.run("tools/pre-push.mjs", [], `refs/heads/main ${head} refs/heads/main ${base}\n`);
      expect(p.status).toBe(1);
      expect(p.stderr).toMatch(/commit .*evil\.txt.*phone/);
    });
  });

  it("a clean merge passes", () => {
    const r = mk();
    const base = r.commit("a.txt", "fine\n", "S-01: base");
    r.git("checkout", "-q", "-b", "side");
    r.commit("s.txt", "side\n", "S-01: side work");
    r.git("checkout", "-q", "main");
    r.commit("m.txt", "main\n", "S-01: main work");
    r.git("merge", "-q", "--no-ff", "-m", "S-01: merge side", "side");
    expect(scanRevisions([`${base}..HEAD`], [], r.dir)).toEqual([]);
    const p = r.run("tools/pre-push.mjs", [], `refs/heads/main ${r.git("rev-parse", "HEAD")} refs/heads/main ${base}\n`);
    expect(p.status).toBe(0);
  });

  it("scanRevisions scans a file sorting just before a package-lock.json in the same commit", () => {
    const r = mk();
    const base = r.commit("a.txt", "fine\n", "S-01: base");
    r.put("package-a.txt", "call " + PHONE + "\n");
    r.put("package-lock.json", "call " + PHONE + "\n");
    r.git("add", ".");
    r.git("commit", "-q", "-m", "S-01: two files");
    const f = scanRevisions([`${base}..HEAD`], [], r.dir) as F[];
    expect(f).toHaveLength(1);
    expect(f[0]!.file).toContain("package-a.txt");
  });

  describe("CLI history scan fails closed", () => {
    it("exits non-zero when git cannot read history (missing object)", () => {
      const r = mk();
      r.commit("a.txt", "fine\n", "S-01: base");
      const blob = r.git("rev-parse", "HEAD:a.txt");
      rmSync(join(r.dir, ".git/objects", blob.slice(0, 2), blob.slice(2)), { force: true });
      const p = r.run("tools/pii-scan.mjs", []);
      expect(p.status).not.toBe(0);
    });
    it("an empty repository with no commits is nothing to scan", () => {
      const r = mk();
      const p = r.run("tools/pii-scan.mjs", []);
      expect(p.status).toBe(0);
    });
  });
});
