// Personal-data and secrets scan (brief 11.6, T-12). Usage: node tools/pii-scan.mjs
// Scans git-tracked files (plus untracked, non-ignored ones so a local run sees new
// work before commit). Reports file:line and rule only, never the matched value.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Files whose content is machine-generated and full of hashes.
const SKIP_CONTENT = new Set(["package-lock.json"]);

const SYNTHETIC_PHONE = /^(?:91)?90000000\d{2}$/;
const ALLOWED_EMAIL = [/@users\.noreply\.github\.com$/i, /^noreply@anthropic\.com$/i];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// Candidate phone: optional +, then digits with single space/hyphen/bracket separators.
const PHONE = /(?<![\w.+-])(\+?)(\(?\d[\d\s\-()]{7,18}\d)(?![\w-])/g;
const SHEET_URL = /docs\.google\.com\/spreadsheets/i;
const SHEET_ID_NEAR = /spreadsheets[^\n]{0,80}?(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{44}(?![A-Za-z0-9_-])/i;
const SECRETS = [
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bya29\.[A-Za-z0-9_-]{20,}/,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:secret|token|passw(?:or)?d|api[_-]?key|client[_-]?secret)\w*["']?\s*[:=]\s*["'][A-Za-z0-9/+_.=-]{16,}["']/i,
];

function isPhone(sep, body) {
  const digits = body.replace(/\D/g, "");
  if (SYNTHETIC_PHONE.test(digits)) return false;
  if (sep === "+") return digits.length >= 10 && digits.length <= 15;
  if (/^[6-9]\d{9}$/.test(digits)) return true; // Indian mobile
  return /^91[6-9]\d{9}$/.test(digits) || /^0[6-9]\d{9}$/.test(digits);
}

export function scanText(file, text) {
  const findings = [];
  const add = (line, rule) => findings.push({ file, line, rule });
  text.split("\n").forEach((content, i) => {
    const line = i + 1;
    for (const m of content.matchAll(PHONE)) if (isPhone(m[1], m[2])) add(line, "phone");
    for (const m of content.matchAll(EMAIL)) {
      if (!ALLOWED_EMAIL.some((re) => re.test(m[0]))) add(line, "email");
    }
    if (SHEET_URL.test(content) || SHEET_ID_NEAR.test(content)) add(line, "sheet");
    if (SECRETS.some((re) => re.test(content))) add(line, "secret");
  });
  return findings;
}

export function scanPaths(paths) {
  return paths.flatMap((p) => {
    const out = [];
    if (/^private\//.test(p)) out.push({ file: p, line: 0, rule: "tracked-private" });
    if (/\.xlsx$/i.test(p)) out.push({ file: p, line: 0, rule: "tracked-xlsx" });
    return out;
  });
}

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tracked = git("ls-files", "-z");
  const untracked = git("ls-files", "-z", "--others", "--exclude-standard");
  const findings = scanPaths(tracked);
  for (const file of [...tracked, ...untracked]) {
    if (SKIP_CONTENT.has(file) || !existsSync(file)) continue;
    const buf = readFileSync(file);
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    findings.push(...scanText(file, buf.toString("utf8")));
  }
  for (const f of findings) console.error(`FAIL ${f.file}${f.line ? `:${f.line}` : ""}  ${f.rule}`);
  console.log(`pii-scan: ${tracked.length + untracked.length} files, ${findings.length} finding(s)`);
  process.exit(findings.length ? 1 : 0);
}
