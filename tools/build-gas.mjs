// Builds the Apps Script bundle into dist/appscript/ (pushed with clasp, never
// part of the site: tools/size-budget.mjs skips this folder).
import { cpSync, mkdirSync } from "node:fs";
import { build } from "esbuild";

const out = "dist/appscript";
mkdirSync(out, { recursive: true });
await build({
  entryPoints: ["src/appscript/main.ts"],
  outfile: `${out}/Code.js`,
  bundle: true,
  minify: false,
  target: "es2019",
  format: "iife",
  globalName: "A44",
  legalComments: "none",
  // Top-level declarations so the editor's Run menu lists them.
  footer: {
    js: "function scrubStaging() { A44.scrubStagingRun(); }\nfunction migrateSheet() { A44.migrateSheetRun(); }\n",
  },
});
cpSync("src/appscript/appsscript.json", `${out}/appsscript.json`);
console.log(`built ${out}/`);
