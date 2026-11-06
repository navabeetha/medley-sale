// S-13 Q1: a blank or typo'd State never overwrites the seller's own note (edit path and timed path). Our note goes only where the cell has no note or one of ours. (docs/backlog/stories/S-13-whatsapp-handoff.md). Synthetic data only; in-memory fake sheet.
import { describe, expect, it } from "vitest";
import { BLANK_STATE, NOT_A_STATE } from "../../src/api/seller-sheet";
import { STATE_COL, STAMP, build, claimsTab, harness, noteOf, rowOfClaim, type SeedClaim } from "../fixtures/queue-sheet";

const SELLER_NOTE = "Hers: Dev said he will collect Friday"; // the seller's own words, synthetic
const setState = (h: ReturnType<typeof harness>, id: number, v: string | null) => {
  claimsTab(h.ss).grid[rowOfClaim(h.ss, id) - 1]![STATE_COL - 1] = v;
};
const putNote = (h: ReturnType<typeof harness>, id: number, text: string) => claimsTab(h.ss).setNote(rowOfClaim(h.ss, id), STATE_COL, text);


// ---- Q1

describe("Q1: a blank or typo'd State never overwrites the seller's own note", () => {
  const SEED: SeedClaim[] = [{ id: 1, item: "I-0001", promoted: STAMP }, { id: 2, item: "I-0001" }];

  it("edit path: clearing the cell keeps her note", () => {
    const h = harness(build(SEED));
    putNote(h, 2, SELLER_NOTE);
    h.edit(2, "");
    expect(noteOf(h.ss, 2)).toBe(SELLER_NOTE);
  });

  it("edit path: typing a typo keeps her note", () => {
    const h = harness(build(SEED));
    putNote(h, 2, SELLER_NOTE);
    h.edit(2, "Sold ");
    expect(noteOf(h.ss, 2)).toBe(SELLER_NOTE);
  });

  it("timed path: a blank State keeps her note", () => {
    const h = harness(build(SEED));
    setState(h, 2, null);
    putNote(h, 2, SELLER_NOTE);
    h.recalc();
    expect(noteOf(h.ss, 2)).toBe(SELLER_NOTE);
  });

  it("timed path: a typo'd State keeps her note", () => {
    const h = harness(build(SEED));
    setState(h, 2, "Sold ");
    putNote(h, 2, SELLER_NOTE);
    h.recalc();
    expect(noteOf(h.ss, 2)).toBe(SELLER_NOTE);
  });

  it("still writes our note where there is none, and swaps one of ours for the right one", () => {
    const h = harness(build(SEED));
    h.edit(2, "Sold ");
    expect(noteOf(h.ss, 2)).toBe(NOT_A_STATE);
    h.edit(2, "");
    expect(noteOf(h.ss, 2)).toBe(BLANK_STATE);
  });
});

