// Size budget check (brief 8.1, D-022). Usage: node tools/size-budget.mjs [dir]
// HTML+CSS+JS: gzip level 9, summed, <= 50 KB. Photos under photos/:
// files with "thumb" in the name <= 12 KB, other photos <= 120 KB.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const BUDGETS = { codeGzip: 50 * 1024, thumb: 12 * 1024, photo: 120 * 1024 };

const CODE_EXT = new Set([".html", ".css", ".js", ".mjs"]);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

export function checkBudgets(dir) {
  const problems = [];
  let codeGzipBytes = 0;
  for (const file of walk(dir)) {
    const rel = relative(dir, file).split(sep);
    if (rel[0] === "photos") {
      const size = statSync(file).size;
      const isThumb = /thumb/i.test(rel.slice(1).join("/"));
      const limit = isThumb ? BUDGETS.thumb : BUDGETS.photo;
      if (size > limit) {
        problems.push(`${isThumb ? "Thumbnail" : "Photo"} ${rel.join("/")} is ${kb(size)}, limit ${kb(limit)}`);
      }
    } else if (CODE_EXT.has(extname(file).toLowerCase())) {
      codeGzipBytes += gzipSync(readFileSync(file), { level: 9 }).length;
    }
  }
  if (codeGzipBytes > BUDGETS.codeGzip) {
    problems.push(`HTML+CSS+JS is ${kb(codeGzipBytes)} gzipped, limit ${kb(BUDGETS.codeGzip)}`);
  }
  return { ok: problems.length === 0, codeGzipBytes, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? "dist";
  if (!existsSync(dir)) {
    console.error(`size-budget: ${dir} not found (run npm run build)`);
    process.exit(2);
  }
  const r = checkBudgets(dir);
  console.log(`HTML+CSS+JS: ${kb(r.codeGzipBytes)} gzipped of ${kb(BUDGETS.codeGzip)}`);
  for (const p of r.problems) console.error(`FAIL ${p}`);
  process.exit(r.ok ? 0 : 1);
}
