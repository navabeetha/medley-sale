// Builds the static site into dist/: copies public/ and bundles src/site/main.ts.
// G1: also builds a staging copy into dist/staging/ (served at /medley-sale/staging/) whose bundle uses
// src/site/config.staging.ts instead of src/site/config.ts. (public/index.html is already noindex.)
import { cpSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const options = { entryPoints: ["src/site/main.ts"], bundle: true, minify: true, target: "es2020", format: "iife", legalComments: "none" };

/** Points every `./config` import in src/site at config.staging.ts. */
const stagingConfig = {
  name: "staging-config",
  setup(b) {
    b.onResolve({ filter: /^\.\/config$/ }, () => ({ path: resolve("src/site/config.staging.ts") }));
  },
};

// Output folder: dist by default; tests pass their own temp folder so they never delete dist/appscript under another test.
const out = process.argv[2] ?? "dist";
rmSync(out, { recursive: true, force: true });
cpSync("public", out, { recursive: true });
await build({ ...options, outfile: `${out}/main.js` });

cpSync("public", `${out}/staging`, { recursive: true });
await build({ ...options, outfile: `${out}/staging/main.js`, plugins: [stagingConfig] });
console.log(`built ${out}/ and ${out}/staging/`);
