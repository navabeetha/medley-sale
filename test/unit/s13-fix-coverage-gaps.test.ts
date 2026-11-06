// S-13 fix (QA coverage gaps, found by mutation probes): the tests below pin what survived. They pass on the code as it is
// and go red if the guarded behaviour is changed. Synthetic data only; in-memory fake sheet.
import { describe, expect, it } from "vitest";
import { buildMessage, buildWhatsappUrl, type MessageUnit } from "../../src/domain/message";
import { NOW, SELLER_DIGITS, SITE, STAMP, build, harness, tokenOf } from "../fixtures/queue-sheet";
import type { FakeTab } from "../fixtures/fake-sheet";

const BASE = `https://wa.me/${SELLER_DIGITS}`;
const TOKEN = "tok-" + "synthetic-" + "0001";
const LINK = `Change or back out: ${SITE}/#/b/${TOKEN}`;
const decode = (url: string): string => decodeURIComponent(url.slice(url.indexOf("?text=") + 6));
const unit = (n: number, name: string, over: Partial<MessageUnit> = {}): MessageUnit => ({
  itemId: `I-${n}`, name, detail: null, isBook: false, price: 1200, outcome: "holder", position: null, ...over,
});

describe("the URL limit is exactly 2,000: 1,999 is allowed, 2,000 is not", () => {
  // Two ASCII titles; the second is padded with one "x" at a time. Every ASCII letter costs exactly one URL character, so the
  // uncut URL grows by exactly 1 per step and must land on 1,999 and on 2,000 (checked below, not assumed).
  const units = (pad: number): MessageUnit[] => [unit(1, "Lamp"), unit(2, `Table${"x".repeat(pad)}`)];
  const uncut = (pad: number): string => `${BASE}?text=${encodeURIComponent(buildMessage("Asha", units(pad), SITE, TOKEN))}`;
  const padFor = (length: number): number => {
    let pad = 0;
    while (uncut(pad).length < length) pad++;
    expect(uncut(pad).length).toBe(length); // the premise: the padding really lands on this length
    return pad;
  };

  it("an uncut URL of exactly 1,999 characters is returned whole, with no 'more' line", () => {
    const pad = padFor(1999);
    const url = buildWhatsappUrl(BASE, "Asha", units(pad), SITE, TOKEN);
    expect(url).toBe(uncut(pad));
    expect(url.length).toBe(1999);
    expect(decode(url)).not.toContain("more");
  });

  it("an uncut URL of exactly 2,000 characters is capped: a bullet goes, '…and 1 more' says so, the URL is under 2,000", () => {
    const pad = padFor(2000);
    const url = buildWhatsappUrl(BASE, "Asha", units(pad), SITE, TOKEN);
    expect(url.length).toBeLessThan(2000);
    expect(decode(url)).toContain("…and 1 more");
    expect(decode(url).split("\n").at(-1)).toBe(LINK);
  });

  it("an uncut URL of 2,001 characters is capped too", () => {
    const url = buildWhatsappUrl(BASE, "Asha", units(padFor(2001)), SITE, TOKEN);
    expect(url.length).toBeLessThan(2000);
    expect(decode(url)).toContain("…and 1 more");
  });
});

describe("a heading never stands without a bullet after the cap", () => {
  // One short held bullet and one waiting bullet that cannot fit next to it: only the held bullet survives, so the
  // "On the waiting list:" heading must go too (and the blank line before it), leaving "…and 1 more" after the held bullet.
  const text = decode(buildWhatsappUrl(BASE, "Asha", [unit(1, "Lamp"), unit(2, "w".repeat(1900), { outcome: "waiting", position: 1 })], SITE, TOKEN));

  it("drops the waiting heading when its only bullet is dropped", () => {
    expect(text).toContain("• Lamp, ₹1,200");
    expect(text).toContain("…and 1 more");
    expect(text).not.toContain("On the waiting list:");
  });

  it("keeps the held heading, the held bullet, then the 'more' line and the link, in that order", () => {
    expect(text.split("\n")).toEqual(["Hi! I'm Asha.", "", "Reserved for me:", "• Lamp, ₹1,200", "…and 1 more", "", LINK]);
  });

  it("the other way round: a waiting-only basket whose bullets are all cut leaves no heading (greeting and link only)", () => {
    // The greeting stays (see s13-fix-greeting); only the heading rule is pinned here.
    const t = decode(buildWhatsappUrl(BASE, "Asha", [unit(1, "w".repeat(1900), { outcome: "waiting", position: 1 })], SITE, TOKEN));
    expect(t).not.toContain("On the waiting list:");
  });
});

describe("waOpened stamps the right booking, not just the first one", () => {
  const SEED = [{ id: 1, item: "I-0001", promoted: STAMP }, { id: 2, item: "I-0001" }];
  const openedOf = (h: ReturnType<typeof harness>, booking: number) => {
    const t = h.ss.getTab("Bookings") as FakeTab;
    const col = t.grid[0]!.indexOf("WhatsApp opened");
    return t.grid.find((r, i) => i > 0 && r[0] === booking)![col] ?? null;
  };
  const run = async (ss: unknown, request: unknown, deps: unknown) => {
    const modPath = new URL("../../src/api/wa-opened.ts", import.meta.url).pathname;
    const mod = (await import(/* @vite-ignore */ modPath)) as { waOpened: (s: unknown, r: unknown, d: unknown) => unknown };
    return mod.waOpened(ss, request, deps);
  };

  it("booking 2's token stamps booking 2 with the time and leaves booking 1 untouched", async () => {
    const h = harness(build(SEED));
    expect(await run(h.ss, { token: tokenOf(2) }, h.deps)).toEqual({ ok: true });
    expect(openedOf(h, 2)).toBe(NOW);
    expect(openedOf(h, 1)).toBeNull();
  });

  it("booking 1 already stamped earlier: stamping booking 2 keeps booking 1's first time", async () => {
    const h = harness(build(SEED));
    await run(h.ss, { token: tokenOf(1) }, { ...h.deps, now: () => "2026-11-05T08:00:00.000Z" });
    await run(h.ss, { token: tokenOf(2) }, h.deps);
    expect(openedOf(h, 1)).toBe("2026-11-05T08:00:00.000Z");
    expect(openedOf(h, 2)).toBe(NOW);
  });
});
