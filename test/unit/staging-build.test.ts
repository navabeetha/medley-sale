// G1 (PM): the Pages site carries a second copy at /staging/ that talks to the build copy's staging deployment,
// so the seller can try reserving on her phone without touching the live (real-sheet, browse-only) site.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { API_URL } from "../../src/site/config";
import { API_URL as STAGING_API_URL } from "../../src/site/config.staging";

describe("staging build", () => {
  beforeAll(() => {
    execFileSync("node", ["tools/build.mjs"], { stdio: "ignore" });
  }, 60_000);

  it("the two configs point at different script.google.com deployments", () => {
    expect(STAGING_API_URL).toMatch(/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/);
    expect(STAGING_API_URL).not.toBe(API_URL);
  });

  it("the live bundle uses only the live API and the staging bundle only the staging API", () => {
    const live = readFileSync("dist/main.js", "utf8");
    const staging = readFileSync("dist/staging/main.js", "utf8");
    expect(live).toContain(API_URL);
    expect(live).not.toContain(STAGING_API_URL);
    expect(staging).toContain(STAGING_API_URL);
    expect(staging).not.toContain(API_URL);
  });

  it("the staging copy has its page and styles, and is kept out of search", () => {
    expect(existsSync("dist/staging/style.css")).toBe(true);
    const html = readFileSync("dist/staging/index.html", "utf8");
    expect(html).toMatch(/<meta name="robots" content="noindex">/);
    expect(readFileSync("dist/index.html", "utf8")).not.toMatch(/noindex/);
  });
});
