// Personal-data and secrets scan (brief 11.6, T-12). Usage: node tools/pii-scan.mjs
// Scans git-tracked files (plus untracked, non-ignored ones so a local run sees new
// work before commit). Reports file:line and rule only, never the matched value.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Files whose content is machine-generated and full of hashes.
const SKIP_CONTENT = new Set(["package-lock.json"]);
// History patches: matched per file by exact basename, so "package-a.txt" next to it is still scanned.
const isLockfile = (path) => path === "package-lock.json" || path.endsWith("/package-lock.json");

const SYNTHETIC_PHONE = /^(?:91|0091)?90000000\d{2}$/;
const ALLOWED_EMAIL = [/@users\.noreply\.github\.com$/i, /^noreply@anthropic\.com$/i, /^noreply@github\.com$/i];

/** A "domain" of only digits and dots is a package version, not an email. */
const isVersionLike = (match) => /^[^@]*@[0-9.]+$/.test(match);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// Candidate phone: optional +, then digits with single space/hyphen/bracket separators.
// Separators: space, hyphen, brackets, dot and slash.
const PHONE = /(?<![\w.+/-])(\+?)(\(?\d[\d\s\-()./]{7,18}\d)(?![\w-])/g;
// Percent-encoded @ (mailto links, query strings).
const ENCODED_EMAIL = /[A-Za-z0-9._+-]+%40[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/gi;
const SHEET_URL = /docs\.google\.com\/spreadsheets/i;
const SHEET_ID_NEAR = /spreadsheets[^\n]{0,80}?(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{44}(?![A-Za-z0-9_-])/i;
// openById is flagged only for a string-literal id; one read from script properties is fine.
const SHEET_OTHER = /openById\(\s*["'`]|drive\.google\.com|docs\.google\.com\/(?:document|forms|presentation|file)/i;
// Bare 40-50 char id-like run (url-safe base64 alphabet). Checked for upper, lower and a
// digit in code so hex digests, git SHAs and lowercase words never match; runs longer than
// 50 (script deployment ids, integrity hashes) fail the length bounds.
const BARE_ID = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40,50}(?![A-Za-z0-9_-])/g;
// camelCase/PascalCase code words (handleReserveItemForUnit2): no "_" or "-", every capital
// starts a lowercase word, digits only trail a word (max 3). Random ids break this almost
// always: a capital next to a capital, a digit or a separator is common in base64url.
const CODE_WORD = /^[A-Za-z][a-z]*\d{0,3}(?:[A-Z][a-z]+\d{0,3})+$/;
const hasBareId = (content) =>
  [...content.matchAll(BARE_ID)].some((m) => /[A-Z]/.test(m[0]) && /[a-z]/.test(m[0]) && /\d/.test(m[0]) && !CODE_WORD.test(m[0]));
// Personal words that must never be committed (e.g. the owner's first name). They are
// never stored in this public repo: locally they come from private/blocked-words.txt
// (gitignored, one per line, # comments), in CI from the PII_BLOCKED_WORDS secret.
export function loadBlockedWords(envValue, fileText) {
  const words = [...(envValue ?? "").split(","), ...(fileText ?? "").split("\n")]
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w && !w.startsWith("#"));
  return [...new Set(words)];
}

// Fail closed: on a push to the owner repo (and in the pre-push hook) an empty list is an
// error, not a warning, so a missing secret can never silently disable the guard.
export function blockedWordsRequired(argv, env) {
  return argv.includes("--require-blocked-words") || env.REQUIRE_BLOCKED_WORDS === "1";
}

export function blockedWordsProblem(blocked, required) {
  if (blocked.length) return null;
  return required
    ? { fail: true, message: "pii-scan: blocked words are required but none are configured (private/blocked-words.txt or PII_BLOCKED_WORDS)" }
    : { fail: false, message: "pii-scan: no blocked words configured (private/blocked-words.txt or PII_BLOCKED_WORDS)" };
}

const SECRETS = [
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bya29\.[A-Za-z0-9_-]{20,}/,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bGOCSPX-[A-Za-z0-9_-]{16,}/,
  // Booking links carry a bearer token in the fragment (brief 4.3).
  /#\/b\/[A-Za-z0-9_-]{16,}/,
  /(?:secret|token|passw(?:or)?d|api[_-]?key|client[_-]?secret)\w*["']?\s*[:=]\s*["'][A-Za-z0-9/+_.=-]{16,}["']/i,
];

function isPhone(sep, body) {
  const digits = body.replace(/\D/g, "");
  if (SYNTHETIC_PHONE.test(digits)) return false;
  if (sep === "+") return digits.length >= 10 && digits.length <= 15;
  if (/^[6-9]\d{9}$/.test(digits)) return true; // Indian mobile
  return /^(?:0091|91)[6-9]\d{9}$/.test(digits) || /^0[6-9]\d{9}$/.test(digits);
}

export function scanText(file, text, blocked = []) {
  const findings = [];
  const add = (line, rule) => findings.push({ file, line, rule });
  text.split("\n").forEach((content, i) => {
    const line = i + 1;
    for (const m of content.matchAll(PHONE)) if (isPhone(m[1], m[2])) add(line, "phone");
    for (const m of content.matchAll(EMAIL)) {
      if (isVersionLike(m[0])) continue; // pkg@1.2.3 is not an address
      if (!ALLOWED_EMAIL.some((re) => re.test(m[0]))) add(line, "email");
    }
    for (const m of content.matchAll(ENCODED_EMAIL)) {
      if (!ALLOWED_EMAIL.some((re) => re.test(m[0].replace(/%40/i, "@")))) add(line, "email");
    }
    if (SHEET_URL.test(content) || SHEET_ID_NEAR.test(content) || SHEET_OTHER.test(content) || hasBareId(content)) add(line, "sheet");
    if (SECRETS.some((re) => re.test(content))) add(line, "secret");
    if (blocked.length) {
      for (const w of content.matchAll(/\p{L}+/gu)) {
        if (blocked.includes(w[0].toLowerCase())) { add(line, "blocked-word"); break; }
      }
    }
  });
  return findings;
}

export function scanPaths(paths) {
  return paths.flatMap((p) => {
    const out = [];
    if (/^private\//.test(p)) out.push({ file: p, line: 0, rule: "tracked-private" });
    if (/\.xlsx$/i.test(p)) out.push({ file: p, line: 0, rule: "tracked-xlsx" });
    if (/(?:^|\/)\.clasp\.json$/.test(p)) out.push({ file: p, line: 0, rule: "tracked-clasp" });
    if (/(?:^|\/)\.env(?:\.[^/]*)?$/.test(p)) out.push({ file: p, line: 0, rule: "tracked-env" });
    if (/\.(?:csv|ods|xls)$/i.test(p)) out.push({ file: p, line: 0, rule: "tracked-export" });
    return out;
  });
}

// Commit metadata is public too: scan messages and author/committer identities. Findings
// name the commit (short sha) and part, never the matched value.
export const GIT_LOG_FORMAT = "%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e";

export function parseLog(text) {
  return text.split("\x1e").flatMap((rec) => {
    const [sha, authorName, authorEmail, committerName, committerEmail, ...msg] = rec.replace(/^\n/, "").split("\x1f");
    if (!sha) return [];
    return [{ sha, authorName, authorEmail, committerName, committerEmail, message: msg.join("\x1f").trimEnd() }];
  });
}

export function scanCommits(commits, blocked = []) {
  return commits.flatMap((c) => {
    const at = `commit ${c.sha.slice(0, 7)}`;
    return [
      ...scanText(`${at} message`, c.message, blocked),
      ...scanText(`${at} author`, `${c.authorName} <${c.authorEmail}>`, blocked),
      ...scanText(`${at} committer`, `${c.committerName} <${c.committerEmail}>`, blocked),
    ];
  });
}

// File content of commits is public too, including lines a later commit deleted. Parses
// `git log -p -U0 --format=%x1e%H` output: for each commit and file, the added ("+") lines
// go through scanText. Findings name commit and file, never the matched value.
export function scanPatchLog(text, blocked = []) {
  const findings = [];
  for (const rec of text.split("\x1e")) {
    const lines = rec.split("\n");
    const sha = lines.shift()?.trim();
    if (!sha) continue;
    let file = null;
    let inHunk = false;
    let added = [];
    const flush = () => {
      if (file && !isLockfile(file) && added.length) {
        findings.push(...scanText(`commit ${sha.slice(0, 7)} ${file}`, added.join("\n"), blocked).map((f) => ({ ...f, line: 0 })));
      }
      added = [];
    };
    for (const l of lines) {
      // Never starts with + - space or backslash, so it is a real header even inside a hunk.
      if (l.startsWith("diff --git ")) { flush(); file = null; inHunk = false; continue; }
      if (inHunk && (l.startsWith("+") || l.startsWith("-") || l.startsWith(" ") || l.startsWith("\\"))) {
        if (l.startsWith("+")) added.push(l.slice(1));
        continue;
      }
      if (l.startsWith("@@")) { inHunk = true; continue; }
      inHunk = false;
      if (l.startsWith("+++ ")) file = l.slice(4).replace(/\t.*$/, "").replace(/^b\//, "");
    }
    flush();
  }
  return findings;
}

// Commits written before the scan existed contain fictional fixtures (90000 001xx style)
// that the rules rightly flag. tools/pii-history-allow.txt lists them exactly, one per line
// as "commit <sha7> <path> <rule>"; nothing else is excused. Messages and identities are
// never allowlisted.
export function applyHistoryAllowlist(findings, text) {
  const allowed = new Set(text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
  return findings.filter((f) => !(f.file.startsWith("commit ") && allowed.has(`${f.file} ${f.rule}`)));
}

const ALLOW_FILE = fileURLToPath(new URL("./pii-history-allow.txt", import.meta.url));
const readAllowlist = () => (existsSync(ALLOW_FILE) ? readFileSync(ALLOW_FILE, "utf8") : "");

// Scans every commit selected by revArgs (rev-list arguments): patch content of added
// lines, plus added/renamed paths through scanPaths. The authoritative pushed-content check.
export function scanRevisions(revArgs, blocked = [], cwd = process.cwd()) {
  const run = (extra, tail = []) =>
    execFileSync("git", ["-c", "core.quotepath=false", "log", "--no-color", "--no-ext-diff", "--no-textconv", ...extra, ...revArgs, ...tail],
      { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  // No pathspec (it triggers history simplification that drops side-branch commits), and
  // merges show their diff against the first parent so content introduced by the merge
  // itself is seen. Lockfiles are skipped per file in the parser.
  const mode = ["--full-history", "--diff-merges=first-parent"];
  const patches = run([...mode, "-p", "-U0", "--format=%x1e%H"]);
  const names = run([...mode, "--name-only", "--diff-filter=AR", "--format=%x1e%H"]);
  const findings = scanPatchLog(patches, blocked);
  for (const rec of names.split("\x1e")) {
    const [sha, ...paths] = rec.split("\n").map((x) => x.trim()).filter(Boolean);
    if (!sha) continue;
    findings.push(...scanPaths(paths).map((f) => ({ ...f, file: `commit ${sha.slice(0, 7)} ${f.file}` })));
  }
  return applyHistoryAllowlist(findings, readAllowlist());
}

export function readBlockedWords(env = process.env) {
  const listFile = env.PII_BLOCKED_WORDS_FILE ?? "private/blocked-words.txt";
  return loadBlockedWords(env.PII_BLOCKED_WORDS, existsSync(listFile) ? readFileSync(listFile, "utf8") : undefined);
}

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tracked = git("ls-files", "-z");
  const untracked = git("ls-files", "-z", "--others", "--exclude-standard");
  const blocked = readBlockedWords();
  const problem = blockedWordsProblem(blocked, blockedWordsRequired(process.argv.slice(2), process.env));
  if (problem) console[problem.fail ? "error" : "warn"](problem.message);
  const findings = scanPaths(tracked);
  for (const file of [...tracked, ...untracked]) {
    if (SKIP_CONTENT.has(file) || !existsSync(file)) continue;
    const buf = readFileSync(file);
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    findings.push(...scanText(file, buf.toString("utf8"), blocked));
  }
  // Everything reachable from HEAD (CI checks out full history). Only a repository with no
  // commits is skipped, detected explicitly; any git error fails the scan.
  const hasCommits = spawnSync("git", ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], { stdio: "ignore" }).status === 0;
  if (hasCommits) {
    const log = execFileSync("git", ["log", `--format=${GIT_LOG_FORMAT}`, "HEAD"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] });
    findings.push(...scanCommits(parseLog(log), blocked));
    findings.push(...scanRevisions(["HEAD"], blocked));
  }
  for (const f of findings) console.error(`FAIL ${f.file}${f.line ? `:${f.line}` : ""}  ${f.rule}`);
  console.log(`pii-scan: ${tracked.length + untracked.length} files, ${findings.length} finding(s)`);
  process.exit(findings.length || problem?.fail ? 1 : 0);
}
