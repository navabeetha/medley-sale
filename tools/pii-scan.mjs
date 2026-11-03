// Personal-data and secrets scan (brief 11.6, T-12). Usage: node tools/pii-scan.mjs
// Scans git-tracked files (plus untracked, non-ignored ones so a local run sees new
// work before commit). Reports file:line and rule only, never the matched value.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Files whose content is machine-generated and full of hashes.
const SKIP_CONTENT = new Set(["package-lock.json"]);

const SYNTHETIC_PHONE = /^(?:91|0091)?90000000\d{2}$/;
const ALLOWED_EMAIL = [/@users\.noreply\.github\.com$/i, /^noreply@anthropic\.com$/i, /^noreply@github\.com$/i];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// Candidate phone: optional +, then digits with single space/hyphen/bracket separators.
// Separators: space, hyphen, brackets, dot and slash.
const PHONE = /(?<![\w.+/-])(\+?)(\(?\d[\d\s\-()./]{7,18}\d)(?![\w-])/g;
// Percent-encoded @ (mailto links, query strings).
const ENCODED_EMAIL = /[A-Za-z0-9._+-]+%40[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/gi;
const SHEET_URL = /docs\.google\.com\/spreadsheets/i;
const SHEET_ID_NEAR = /spreadsheets[^\n]{0,80}?(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{44}(?![A-Za-z0-9_-])/i;
const SHEET_OTHER = /openById\(|drive\.google\.com|docs\.google\.com\/(?:document|forms|presentation|file)/i;
// Bare 40-50 char id-like run (url-safe base64 alphabet). Checked for upper, lower and a
// digit in code so hex digests, git SHAs and lowercase words never match; runs longer than
// 50 (script deployment ids, integrity hashes) fail the length bounds.
const BARE_ID = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40,50}(?![A-Za-z0-9_-])/g;
const hasBareId = (content) =>
  [...content.matchAll(BARE_ID)].some((m) => /[A-Z]/.test(m[0]) && /[a-z]/.test(m[0]) && /\d/.test(m[0]));
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

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tracked = git("ls-files", "-z");
  const untracked = git("ls-files", "-z", "--others", "--exclude-standard");
  const listFile = process.env.PII_BLOCKED_WORDS_FILE ?? "private/blocked-words.txt";
  const blocked = loadBlockedWords(
    process.env.PII_BLOCKED_WORDS,
    existsSync(listFile) ? readFileSync(listFile, "utf8") : undefined,
  );
  const problem = blockedWordsProblem(blocked, blockedWordsRequired(process.argv.slice(2), process.env));
  if (problem) console[problem.fail ? "error" : "warn"](problem.message);
  const findings = scanPaths(tracked);
  for (const file of [...tracked, ...untracked]) {
    if (SKIP_CONTENT.has(file) || !existsSync(file)) continue;
    const buf = readFileSync(file);
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    findings.push(...scanText(file, buf.toString("utf8"), blocked));
  }
  for (const f of findings) console.error(`FAIL ${f.file}${f.line ? `:${f.line}` : ""}  ${f.rule}`);
  console.log(`pii-scan: ${tracked.length + untracked.length} files, ${findings.length} finding(s)`);
  process.exit(findings.length || problem?.fail ? 1 : 0);
}
