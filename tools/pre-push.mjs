// Git pre-push check (installed via .githooks/pre-push). Reads git's stdin lines
// "<local ref> <local sha> <remote ref> <remote sha>", refuses refs that must never leave
// this machine, and scans the commits about to be published (messages, author and
// committer identities). Reports commit and rule only, never the matched value.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  GIT_LOG_FORMAT, parseLog, scanCommits, readBlockedWords, blockedWordsProblem, blockedWordsRequired,
} from "./pii-scan.mjs";

const ZERO = /^0+$/;

export function parsePushLines(text) {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [localRef, localSha, remoteRef, remoteSha] = l.split(/\s+/);
    return { localRef, localSha, remoteRef, remoteSha };
  });
}

// Only branches and tags may be published; pre-rewrite backups (refs/original/) and
// anything a --mirror push would add (remotes, notes, pull refs, HEAD) are refused.
export function refusedRefs(lines) {
  const out = [];
  for (const l of lines) {
    if (l.localRef.startsWith("refs/original/")) out.push({ ref: l.localRef, reason: "refs/original/ holds pre-rewrite history" });
    if (!/^refs\/(?:heads|tags)\//.test(l.remoteRef)) out.push({ ref: l.remoteRef, reason: "only refs/heads/ and refs/tags/ may be pushed" });
  }
  return out;
}

// rev-list arguments for the commits this push would publish; null when nothing is sent.
export function revListArgs(l) {
  if (ZERO.test(l.localSha)) return null; // deleting a remote ref
  if (ZERO.test(l.remoteSha)) return [l.localSha, "--not", "--remotes"]; // new ref
  return [`${l.remoteSha}..${l.localSha}`];
}

function commitsFor(l) {
  const args = revListArgs(l);
  if (!args) return [];
  const run = (a) =>
    execFileSync("git", ["log", `--format=${GIT_LOG_FORMAT}`, ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  try {
    return parseLog(run(args));
  } catch {
    // Remote sha unknown locally (force-push over someone else's work): treat as new.
    return parseLog(run([l.localSha, "--not", "--remotes"]));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lines = parsePushLines(readFileSync(0, "utf8"));
  const blocked = readBlockedWords();
  const problem = blockedWordsProblem(blocked, blockedWordsRequired(process.argv.slice(2), process.env));
  if (problem) console[problem.fail ? "error" : "warn"](problem.message);
  const refused = refusedRefs(lines);
  for (const r of refused) console.error(`REFUSED ${r.ref}  ${r.reason}`);
  const seen = new Set();
  const commits = lines.flatMap(commitsFor).filter((c) => !seen.has(c.sha) && seen.add(c.sha));
  const findings = scanCommits(commits, blocked);
  for (const f of findings) console.error(`FAIL ${f.file}${f.line ? `:${f.line}` : ""}  ${f.rule}`);
  console.log(`pre-push: ${commits.length} commit(s), ${refused.length} refused ref(s), ${findings.length} finding(s)`);
  process.exit(refused.length || findings.length || problem?.fail ? 1 : 0);
}
