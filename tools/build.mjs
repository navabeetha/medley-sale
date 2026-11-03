// Builds the static site into dist/: copies public/ and bundles src/site/main.ts.
import { cpSync, rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });
cpSync("public", "dist", { recursive: true });
await build({
  entryPoints: ["src/site/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  minify: true,
  target: "es2020",
  format: "iife",
  legalComments: "none",
});
console.log("built dist/");
