import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseLog, scanCommits, GIT_LOG_FORMAT } from "../../tools/pii-scan.mjs";
import { parsePushLines, refusedRefs, revListArgs } from "../../tools/pre-push.mjs";

// Fixtures are assembled from pieces so this file does not itself trip the scan.
const ZERO = "0".repeat(40);
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const GOOD_EMAIL = "1+dev" + "@users.noreply.github.com";
const commit = (over: Record<string, string> = {}) => ({
  sha: SHA_A, authorName: "Dev", authorEmail: GOOD_EMAIL, committerName: "Dev", committerEmail: GOOD_EMAIL,
  message: "S-01: tidy", ...over,
});
const rules = (c: ReturnType<typeof commit>, blocked: string[] = []) => scanCommits([c], blocked).map((f) => f.rule);

describe("scanCommits", () => {
  it("passes a clean commit", () => expect(scanCommits([commit()], ["zorblax"])).toEqual([]));

  it("flags a phone number in the message and names the commit, not the value", () => {
    const phone = "+91 90000" + " 00133";
    const f = scanCommits([commit({ message: "S-01: call " + phone })])[0]!;
    expect(f.rule).toBe("phone");
    expect(f.file).toContain("aaaaaaa");
    expect(f.file).toContain("message");
    expect(JSON.stringify(f)).not.toContain("00133");
  });

  it("flags a real-looking email as author or committer", () => {
    expect(rules(commit({ authorEmail: "jane" + "@example.com" }))).toEqual(["email"]);
    expect(rules(commit({ committerEmail: "jane" + "@example.com" }))).toEqual(["email"]);
  });

  it("flags a blocked word in the author or committer name or the message", () => {
    expect(rules(commit({ authorName: "Zorblax Q" }), ["zorblax"])).toEqual(["blocked-word"]);
    expect(rules(commit({ committerName: "zorblax" }), ["zorblax"])).toEqual(["blocked-word"]);
    expect(rules(commit({ message: "for Zorblax" }), ["zorblax"])).toEqual(["blocked-word"]);
  });

  it("parseLog round-trips the log format, multi-line messages included", () => {
    const rec = (c: ReturnType<typeof commit>) =>
      [c.sha, c.authorName, c.authorEmail, c.committerName, c.committerEmail, c.message].join("\x1f") + "\x1e";
    const a = commit({ message: "S-01: one\n\nbody line" });
    const b = commit({ sha: SHA_B, message: "S-01: two" });
    expect(parseLog(rec(a) + "\n" + rec(b) + "\n")).toEqual([a, b]);
    expect(GIT_LOG_FORMAT).toContain("%B");
  });
});

describe("push ref policy", () => {
  const line = (localRef: string, remoteRef: string, localSha = SHA_A, remoteSha = SHA_B) =>
    `${localRef} ${localSha} ${remoteRef} ${remoteSha}`;

  it("parses git's stdin lines", () => {
    expect(parsePushLines(line("refs/heads/a", "refs/heads/a") + "\n\n")).toEqual([
      { localRef: "refs/heads/a", localSha: SHA_A, remoteRef: "refs/heads/a", remoteSha: SHA_B },
    ]);
  });

  it("allows branches and tags", () => {
    expect(refusedRefs(parsePushLines(line("refs/heads/a", "refs/heads/a") + "\n" + line("refs/tags/v1", "refs/tags/v1")))).toEqual([]);
  });

  it("refuses remote refs outside heads and tags (mirror-style pushes)", () => {
    for (const ref of ["refs/original/refs/heads/main", "refs/remotes/origin/x", "refs/notes/c", "refs/pull/1/head", "HEAD"]) {
      expect(refusedRefs(parsePushLines(line("refs/heads/a", ref))).length, ref).toBe(1);
    }
  });

  it("refuses any push whose local ref is under refs/original/, even to a branch", () => {
    expect(refusedRefs(parsePushLines(line("refs/original/refs/heads/main", "refs/heads/main"))).length).toBe(1);
  });

  it("allows deleting a remote branch", () => {
    expect(refusedRefs(parsePushLines(line("(delete)", "refs/heads/old", ZERO)))).toEqual([]);
  });

  it("picks rev-list arguments: range for updates, not-on-any-remote for new refs, none for deletes", () => {
    expect(revListArgs(parsePushLines(line("refs/heads/a", "refs/heads/a"))[0]!)).toEqual([`${SHA_B}..${SHA_A}`]);
    expect(revListArgs(parsePushLines(line("refs/heads/a", "refs/heads/a", SHA_A, ZERO))[0]!)).toEqual([SHA_A, "--not", "--remotes"]);
    expect(revListArgs(parsePushLines(line("(delete)", "refs/heads/a", ZERO, SHA_B))[0]!)).toBeNull();
  });
});

describe("hook wiring", () => {
  it("is an executable .githooks/pre-push that runs the scan with --require-blocked-words", () => {
    expect(statSync(".githooks/pre-push").mode & 0o111).not.toBe(0);
    const body = readFileSync(".githooks/pre-push", "utf8");
    expect(body).toContain("node tools/pii-scan.mjs --require-blocked-words");
    expect(body).toContain("tools/pre-push.mjs");
  });
  it("is installed by the npm prepare script via core.hooksPath", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.prepare).toContain("core.hooksPath .githooks");
  });
});

describe("against a throwaway repo", () => {
  const root = resolve(".");
  let dir = "";
  const env = {
    ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "Dev", GIT_AUTHOR_EMAIL: GOOD_EMAIL, GIT_COMMITTER_NAME: "Dev", GIT_COMMITTER_EMAIL: GOOD_EMAIL,
    PII_BLOCKED_WORDS: "zorblax", PII_BLOCKED_WORDS_FILE: "/nonexistent/none.txt",
  };
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, env, encoding: "utf8" }).trim();
  const commitFile = (name: string, msg: string) => {
    writeFileSync(join(dir, name), name + "\n");
    git("add", name);
    git("commit", "-q", "-m", msg);
    return git("rev-parse", "HEAD");
  };
  const run = (script: string, args: string[], input?: string) =>
    spawnSync("node", [join(root, script), ...args], { cwd: dir, env, input, encoding: "utf8" });

  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "prepush-")); git("init", "-q", "-b", "main"); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("pii-scan CLI scans commit messages reachable from HEAD", () => {
    commitFile("a.txt", "S-01: fine");
    expect(run("tools/pii-scan.mjs", []).status).toBe(0);
    commitFile("b.txt", "S-01: ring " + "+91 90000" + " 00134");
    const r = run("tools/pii-scan.mjs", []);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/commit .*message.*phone/);
    expect(r.stderr).not.toContain("00134");
  });

  it("pre-push refuses a new branch carrying a bad message, and allows a clean one", () => {
    const bad = git("rev-parse", "HEAD");
    const r = run("tools/pre-push.mjs", ["--require-blocked-words"], `refs/heads/main ${bad} refs/heads/main ${ZERO}\n`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("phone");
    const first = git("rev-list", "--max-parents=0", "HEAD");
    const ok = run("tools/pre-push.mjs", ["--require-blocked-words"], `refs/heads/main ${first} refs/heads/main ${ZERO}\n`);
    expect(ok.status).toBe(0);
  });

  it("pre-push scans only the range for an update of an existing branch", () => {
    const first = git("rev-list", "--max-parents=0", "HEAD");
    const head = git("rev-parse", "HEAD");
    const r = run("tools/pre-push.mjs", [], `refs/heads/main ${head} refs/heads/main ${first}\n`);
    expect(r.status).toBe(1);
    const same = run("tools/pre-push.mjs", [], `refs/heads/main ${first} refs/heads/main ${first}\n`);
    expect(same.status).toBe(0);
  });

  it("pre-push refuses refs/original and fails closed without blocked words", () => {
    const first = git("rev-list", "--max-parents=0", "HEAD");
    const r = run("tools/pre-push.mjs", [], `refs/heads/main ${first} refs/original/refs/heads/main ${ZERO}\n`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("refs/original");
    const closed = spawnSync("node", [join(root, "tools/pre-push.mjs"), "--require-blocked-words"], {
      cwd: dir, env: { ...env, PII_BLOCKED_WORDS: "" }, input: "", encoding: "utf8",
    });
    expect(closed.status).toBe(1);
    expect(closed.stderr).toContain("blocked words are required");
  });
});
