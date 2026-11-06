// S-13 fix (QA F1, PM decision on Q1): when an oversell is refused and the State cell already carries the seller's OWN note,
// we neither skip our reason (that hid the oversell when no oldValue let us put the sale back) nor replace her note. We
// append ours: `<her note>\n\n— <reason>`. Later, clearing our reason removes only that suffix; her text stays byte for byte.
// The combined note is not "ours" (isOurStateNote false), so nothing ever overwrites it whole. Synthetic data; in-memory fake sheet.
import { describe, expect, it } from "vitest";
import { isOurStateNote } from "../../src/api/seller-sheet";
import { STATE_COL, STAMP, build, claimsTab, harness, noteOf, rowOfClaim, stateOf } from "../fixtures/queue-sheet";

const HERS = "Hers: Dev said he will collect Friday"; // the seller's own words, synthetic
// Echo Dot qty 1: claim 1 is already sold, so marking claim 2 sold is an oversell. The reason text is the one the
// control case (no note on the cell) writes, so the tests do not hardcode wording.
const SEED = [{ id: 1, item: "I-0001", state: "sold", soldPrice: 2500, soldAt: STAMP }, { id: 2, item: "I-0001" }];
const withNote = () => {
  const h = harness(build(SEED));
  claimsTab(h.ss).setNote(rowOfClaim(h.ss, 2), STATE_COL, HERS);
  return h;
};
const reasonOf = (): string => {
  const c = harness(build(SEED));
  c.edit(2, "sold");
  return noteOf(c.ss, 2)!;
};

describe("Q1 append: a refusal on a cell with her note adds our reason after it", () => {
  it("control: the refusal reason exists and is not her text", () => {
    expect(reasonOf()).toMatch(/already sold/);
  });

  it("no oldValue (a paste): the sale stands, and the note is her text, a blank line, then '— <reason>'", () => {
    const h = withNote();
    const r = h.edit(2, "sold", { oldValue: undefined });
    expect(r).toMatchObject({ handled: true, reverted: false });
    expect(stateOf(h.ss, 2)).toBe("sold"); // nothing to put back without an oldValue
    expect(noteOf(h.ss, 2)).toBe(`${HERS}\n\n— ${reasonOf()}`);
  });

  it("normal path (oldValue known): the sale is put back, and the note is her text plus '— <reason>'", () => {
    const h = withNote();
    const r = h.edit(2, "sold");
    expect(r).toMatchObject({ handled: true, reverted: true });
    expect(stateOf(h.ss, 2)).toBe("active");
    expect(noteOf(h.ss, 2)).toBe(`${HERS}\n\n— ${reasonOf()}`);
  });

  it("a second refusal does not append the reason twice", () => {
    const h = withNote();
    h.edit(2, "sold");
    h.edit(2, "sold");
    expect(noteOf(h.ss, 2)).toBe(`${HERS}\n\n— ${reasonOf()}`);
  });

  it("the combined note is not one of ours, so it is never wholly overwritten", () => {
    expect(isOurStateNote(`${HERS}\n\n— ${reasonOf()}`)).toBe(false);
  });

  it("control: with no note on the cell the reason alone is written, with no dash or blank line", () => {
    expect(reasonOf()).not.toMatch(/^—|\n/);
  });
});

describe("Q1 append: clearing our reason later removes only our suffix", () => {
  it("an accepted edit after a reverted refusal leaves her text exactly as it was", () => {
    const h = withNote();
    h.edit(2, "sold"); // refused, note now combined
    h.edit(2, "released"); // accepted
    expect(noteOf(h.ss, 2)).toBe(HERS);
  });

  it("an accepted edit after a no-oldValue refusal leaves her text exactly as it was", () => {
    const h = withNote();
    h.edit(2, "sold", { oldValue: undefined });
    h.edit(2, "released", { oldValue: "sold" });
    expect(noteOf(h.ss, 2)).toBe(HERS);
  });

  it("her note that happens to end in a dash or blank lines is restored byte for byte", () => {
    const odd = "Hers: call back —\n\n";
    const h = harness(build(SEED));
    claimsTab(h.ss).setNote(rowOfClaim(h.ss, 2), STATE_COL, odd);
    h.edit(2, "sold");
    h.edit(2, "released");
    expect(noteOf(h.ss, 2)).toBe(odd);
  });
});

// QA re-check C1 (PM pin, test-only): her own note may itself contain "\n\n— ". Only a trailing suffix that is one of
// our refusal reasons may be removed, cut at the LAST separator, so none of her text is ever lost.
describe("Q1 append: her note containing our separator", () => {
  const INNER = "Hers: ask first\n\n— then hold till Friday"; // synthetic; has the separator but no refusal reason
  const seed = () => {
    const h = harness(build(SEED));
    claimsTab(h.ss).setNote(rowOfClaim(h.ss, 2), STATE_COL, INNER);
    return h;
  };

  it("refused, then accepted: exactly her note is left", () => {
    const h = seed();
    h.edit(2, "sold");
    expect(noteOf(h.ss, 2)).toBe(`${INNER}\n\n— ${reasonOf()}`);
    h.edit(2, "released");
    expect(noteOf(h.ss, 2)).toBe(INNER);
  });

  it("an accepted edit with no refusal before it leaves her note untouched", () => {
    const h = seed();
    h.edit(2, "released");
    expect(noteOf(h.ss, 2)).toBe(INNER);
  });
});
