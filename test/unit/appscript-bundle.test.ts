// D-036.6: pin the Apps Script bundle's top-level functions and its OAuth scope.
// Only top-level functions show in the editor's Run menu or can be triggers, so
// an accidental extra, or a missing one, matters. The scope list is the privacy
// boundary of the script: it may touch only the sheet it is bound to.
//
// The bundle is built the same way as `npm run build:gas` (writes the gitignored
// dist/appscript/).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
let code = "";

beforeAll(() => {
  execFileSync(process.execPath, ["tools/build-gas.mjs"], { cwd: root, stdio: "pipe" });
  code = readFileSync(resolve(root, "dist/appscript/Code.js"), "utf8");
}, 60_000);

describe("Apps Script bundle", () => {
  it("has exactly these top-level functions: scrubStaging, migrateSheet, addIdColumns, warmCatalogue, doGet, doPost", () => {
    // Column 0 only: the esbuild IIFE indents everything inside it.
    const names = [...code.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
    // S-11 adds doPost (brief 4.3: POST entry, body as text/plain JSON).
    expect(names.sort()).toEqual(["addIdColumns", "doGet", "doPost", "migrateSheet", "scrubStaging", "warmCatalogue"]);
  });

  it("has no other top-level function-like declarations (var/let/const function, class, async)", () => {
    const other = [...code.matchAll(/^(?:async\s+function|class|(?:const|let)\s+\w+\s*=\s*(?:async\s*)?(?:function|\())/gm)];
    expect(other).toEqual([]);
  });

  it("asks for the current-spreadsheet scope only", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "dist/appscript/appsscript.json"), "utf8"));
    expect(manifest.oauthScopes).toEqual(["https://www.googleapis.com/auth/spreadsheets.currentonly"]);
  });

  it("ships the same manifest that is in src/appscript", () => {
    expect(readFileSync(resolve(root, "dist/appscript/appsscript.json"), "utf8")).toBe(
      readFileSync(resolve(root, "src/appscript/appsscript.json"), "utf8"),
    );
  });
});
