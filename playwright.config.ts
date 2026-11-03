import { defineConfig, devices } from "@playwright/test";

// Chromium and WebKit, each with a Pixel and an iPhone profile (brief 8.1).
const profiles = [
  { name: "chromium-pixel", browserName: "chromium", device: "Pixel 7" },
  { name: "webkit-pixel", browserName: "webkit", device: "Pixel 7" },
  { name: "chromium-iphone", browserName: "chromium", device: "iPhone 14" },
  { name: "webkit-iphone", browserName: "webkit", device: "iPhone 14" },
] as const;

export default defineConfig({
  testDir: "test/e2e",
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:4173" },
  projects: profiles.map((p) => ({
    name: p.name,
    use: { ...devices[p.device], browserName: p.browserName },
  })),
  webServer: {
    command: "npm run build && node tools/serve.mjs dist 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
