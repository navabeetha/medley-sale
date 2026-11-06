// S-13 Q1 (PM decision, same rule for every note we write on a State cell): the oversell-refusal note on the edit path
// must not overwrite a note the seller wrote herself. The refusal itself still happens (the sale is put back).
import { describe, expect, it } from "vitest";
import { STATE_COL, STAMP, build, claimsTab, harness, noteOf, rowOfClaim, stateOf } from "../fixtures/queue-sheet";

const SELLER_NOTE = "Hers: Dev said he will collect Friday"; // synthetic
// Echo Dot qty 1: claim 1 is already sold, so marking claim 2 sold is an oversell.
const SEED = [{ id: 1, item: "I-0001", state: "sold", soldPrice: 2500, soldAt: STAMP }, { id: 2, item: "I-0001" }];

describe("Q1: an oversell refusal leaves the seller's own note alone", () => {
  it("still puts the sale back when the cell carries her note", () => {
    const h = harness(build(SEED));
    claimsTab(h.ss).setNote(rowOfClaim(h.ss, 2), STATE_COL, SELLER_NOTE);
    const r = h.edit(2, "sold");
    expect(r).toMatchObject({ handled: true, reverted: true });
    expect(stateOf(h.ss, 2)).toBe("active");
  });

  it("keeps her note instead of replacing it with the refusal reason", () => {
    const h = harness(build(SEED));
    claimsTab(h.ss).setNote(rowOfClaim(h.ss, 2), STATE_COL, SELLER_NOTE);
    h.edit(2, "sold");
    expect(noteOf(h.ss, 2)).toBe(SELLER_NOTE);
  });

  it("control: with no note on the cell the refusal reason is written", () => {
    const h = harness(build(SEED));
    h.edit(2, "sold");
    expect(noteOf(h.ss, 2)).toMatch(/already sold/);
  });
});
