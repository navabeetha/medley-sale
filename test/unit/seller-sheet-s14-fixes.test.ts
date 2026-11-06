// S-14: the four S-15 QA re-check bugfixes carried into S-14 (F7 to F10) and their listed coverage gaps
// (docs/backlog/stories/S-14-back-out.md, "Bugfix tickets carried from S-15 QA re-check"). Tests run against the
// in-memory fake sheet. Synthetic data only. The original S-15 design is in seller-sheet.test.ts; these lines extend it.
//
// DESIGNED INTERFACE CHANGES (the spec for src/api/sheet.ts, seller-sheet.ts, on-edit.ts and the adapter):
//
//   F7  Tab gains   getNotes(col: number): (string | null)[]
//         ONE batch read of a column's notes (Range.getNotes() in Apps Script). Index 0 is row 1 (the header row), so the
//         array lines up with getGrid(); null where a cell has no note ("" from Sheets counts as none). The fake already has
//         it (test/fixtures/fake-sheet.ts) and counts calls in `FakeTab.noteReads` ({ single, batch }).
//         syncStateNotes (and so recalculateAll and the F2 full repair inside onClaimsEdit) reads the State notes with
//         ONE getNotes and never calls getNote per row: a long Claims tab must not hold the lock long enough for a
//         concurrent reserve to answer "busy".
//   F8  A BLANK State on a Claims row that has a Claim ID gets a note of the same kind as NOT_A_STATE, worded to say the cell is
//         empty and to choose active, released or sold. The exact text is the implementer's, but it must match
//         /choose active, released or sold/ and /empty|blank/i and differ from NOT_A_STATE. It is set by recalculateAll
//         (syncStateNotes) and by onClaimsEdit when the seller clears a State cell (still { handled: false }, nothing else
//         written, under the lock so it is flushed and the cache cleared). A row with no Claim ID gets no note. The note
//         is removed (only that text) when the cell holds a valid State; a typo'd State that is then emptied swaps
//         NOT_A_STATE for the blank wording (a note must never describe the wrong problem).
//   F9  ClaimsEdit gains an OPTIONAL   claimId?: number
//         The Claim ID of the edited row as the adapter read it when the trigger fired, BEFORE it waits for the lock
//         (a sort during the lock wait is the race). Under the lock the handler compares it with the Claim ID now on that
//         row. A difference, or a row that no longer holds a Claim ID, means the row is not the edited claim: run the full
//         repair exactly as for a stale State (one lock, D-039: no promotion invented). When claimId is absent the F2
//         State-comparison stays the only check (the adapter is wired to send it; the wiring is a live check).
//   F10 An accepted edit removes the note on that State cell ONLY when it is one of ours: NOT_A_STATE, the F8 blank wording,
//         or a sale-refusal reason (the canMarkSold wording, or the oversell explanation). A note the seller wrote
//         herself is left alone.
//   Coverage gaps (characterisation of existing behaviour; these may pass before any change, see the report): the blank
//         normalisation in the F2 staleness check (null, "" and whitespace are the same blank); the blank-newValue early
//         return; a typo'd State on a row with no Claim ID gets no note (recalculateAll and onClaimsEdit).
import { describe, expect, it } from "vitest";
import { CATALOGUE_CACHE_KEY } from "../../src/api/handle-get";
import { NOT_A_STATE } from "../../src/api/seller-sheet";
import { onClaimsEdit } from "../../src/api/on-edit";
import type { CellValue } from "../../src/api/sheet";
import {
  CLAIM_HEADERS, NOW, STAMP, STATE_COL, build, claimsTab, harness, itemRow, noteOf, rowOfClaim, stamp, stateOf,
  type Harness, type SeedClaim,
} from "../fixtures/queue-sheet";
import type { FakeSpreadsheet } from "../fixtures/fake-sheet";

const BLANK_WORDING = /choose active, released or sold/;
const noteReads = (ss: FakeSpreadsheet) => ({
  single: ss.tabs.reduce((n, t) => n + t.noteReads.single, 0),
  batch: ss.tabs.reduce((n, t) => n + t.noteReads.batch, 0),
});
const resetNoteReads = (ss: FakeSpreadsheet) => ss.tabs.forEach((t) => { t.noteReads = { single: 0, batch: 0 }; });

/** A Claims row with a Claim ID and an empty State, the way a seller's Delete leaves it. */
function blankStateRow(ss: FakeSpreadsheet, id: number, cell: CellValue = null): void {
  const t = claimsTab(ss);
  t.grid[rowOfClaim(ss, id) - 1]![STATE_COL - 1] = cell;
}
/** A Claims row with no Claim ID, the given State, and nothing else. */
function addRowWithoutId(ss: FakeSpreadsheet, state: CellValue): number {
  claimsTab(ss).appendRow(CLAIM_HEADERS.map((h) => (h === "State" ? state : null)));
  return claimsTab(ss).grid.length;
}

// ---- F7: one batch read of the notes under the lock

describe("syncStateNotes reads the State notes in one batch (S-15 QA re-check F7)", () => {
  // 30 claims on a quantity-3 item: enough rows that "one read per row" is clearly visible.
  const MANY: SeedClaim[] = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, item: "I-0002" }));

  it("recalculateAll reads the State column's notes with one getNotes call and no per-row getNote", () => {
    const h = harness(build(MANY));
    resetNoteReads(h.ss);
    h.recalc();
    expect(noteReads(h.ss).single).toBe(0);
    expect(noteReads(h.ss).batch).toBe(1);
  });

  it("still sets and clears the notes correctly when it reads them in a batch (typo, blank, fixed)", () => {
    const h = harness(build([...MANY, { id: 31, item: "I-0001", state: "Sold " }, { id: 32, item: "I-0001" }]));
    blankStateRow(h.ss, 5);
    claimsTab(h.ss).setNote(rowOfClaim(h.ss, 6), STATE_COL, NOT_A_STATE); // stale note on a valid cell
    h.recalc();
    expect(noteOf(h.ss, 31)).toBe(NOT_A_STATE);
    expect(noteOf(h.ss, 5)).toMatch(BLANK_WORDING);
    expect(noteOf(h.ss, 6)).toBeNull();
    expect(noteOf(h.ss, 7)).toBeNull();
  });

  it("the full repair inside a stale-row edit (F2) reads notes in one batch too", () => {
    const h = harness(build([...MANY, { id: 31, item: "I-0001", promoted: STAMP }, { id: 32, item: "I-0001" }]));
    const t = claimsTab(h.ss);
    const row = rowOfClaim(h.ss, 31);
    t.grid[row - 1]![STATE_COL - 1] = "released";
    t.grid = [t.grid[0]!, ...t.grid.slice(1).reverse()]; // a sort: the edited row now holds another claim
    resetNoteReads(h.ss);
    onClaimsEdit(h.ss, { tab: "Claims", row, column: STATE_COL, oldValue: "active", newValue: "released" }, h.deps as never);
    expect(noteReads(h.ss).single).toBeLessThanOrEqual(2); // not one per row
    expect(noteReads(h.ss).batch).toBeLessThanOrEqual(1);
  });
});

// ---- F8: a blank State on a row with a Claim ID

describe("recalculateAll: a blank State on a claim row (S-15 QA re-check F8)", () => {
  const SEED: SeedClaim[] = [{ id: 1, item: "I-0001" }, { id: 2, item: "I-0001" }, { id: 3, item: "I-0002" }];

  for (const [label, cell] of [["empty (null)", null], ["an empty string", ""], ["spaces only", "   "]] as const) {
    it(`notes a State cell that is ${label}, with wording that says to choose active, released or sold`, () => {
      const h = harness(build(SEED));
      blankStateRow(h.ss, 1, cell);
      h.recalc();
      const note = noteOf(h.ss, 1);
      expect(note).not.toBeNull();
      expect(note).toMatch(BLANK_WORDING);
      expect(note).toMatch(/empty|blank/i);
      expect(note).not.toBe(NOT_A_STATE); // the typo wording would describe the wrong problem
      expect(claimsTab(h.ss).grid[rowOfClaim(h.ss, 1) - 1]![STATE_COL - 1]).toBe(cell); // the cell itself is never written
    });
  }

  it("notes only rows that have a Claim ID: a blank State on an id-less row gets no note", () => {
    const h = harness(build(SEED));
    const row = addRowWithoutId(h.ss, null);
    h.recalc();
    expect(claimsTab(h.ss).getNote(row, STATE_COL)).toBeNull();
    expect(claimsTab(h.ss).notes).toEqual([]);
  });

  it("is stable: a second run writes nothing", () => {
    const h = harness(build(SEED));
    blankStateRow(h.ss, 1);
    h.recalc();
    const after = h.ss.snapshot();
    h.events.length = 0;
    h.recalc();
    expect(h.events).not.toContain("write");
    expect(h.ss.snapshot()).toBe(after);
  });

  it("removes the blank note once the cell holds a valid State, and leaves the seller's own notes alone", () => {
    const h = harness(build(SEED));
    blankStateRow(h.ss, 1);
    blankStateRow(h.ss, 3);
    h.recalc();
    claimsTab(h.ss).grid[rowOfClaim(h.ss, 1) - 1]![STATE_COL - 1] = "active"; // the seller picks a State again
    claimsTab(h.ss).setNote(rowOfClaim(h.ss, 2), STATE_COL, "Holding this for the neighbour"); // not ours
    h.recalc();
    expect(noteOf(h.ss, 1)).toBeNull();
    expect(noteOf(h.ss, 2)).toBe("Holding this for the neighbour");
    expect(noteOf(h.ss, 3)).toMatch(BLANK_WORDING); // still blank
  });

  it("swaps the typo note for the blank wording when a typo'd cell is then emptied, and back again", () => {
    const h = harness(build([{ id: 1, item: "I-0001", state: "Sold " }, { id: 2, item: "I-0001" }]));
    h.recalc();
    expect(noteOf(h.ss, 1)).toBe(NOT_A_STATE);
    blankStateRow(h.ss, 1);
    h.recalc();
    expect(noteOf(h.ss, 1)).toMatch(BLANK_WORDING);
    expect(noteOf(h.ss, 1)).not.toBe(NOT_A_STATE);
    claimsTab(h.ss).grid[rowOfClaim(h.ss, 1) - 1]![STATE_COL - 1] = "Sold ";
    h.recalc();
    expect(noteOf(h.ss, 1)).toBe(NOT_A_STATE);
  });
});

describe("onClaimsEdit: the seller clears a State cell (S-15 QA re-check F8 and the blank-newValue gap)", () => {
  const TWO: SeedClaim[] = [{ id: 1, item: "I-0001", promoted: STAMP }, { id: 2, item: "I-0001" }, { id: 3, item: "I-0002" }];

  /** The seller deletes the cell. `gridValue` is what the grid holds, `newValue` what the event says. */
  function clear(h: Harness, id: number, gridValue: CellValue, newValue: CellValue) {
    const row = rowOfClaim(h.ss, id);
    claimsTab(h.ss).grid[row - 1]![STATE_COL - 1] = gridValue;
    return onClaimsEdit(h.ss, { tab: "Claims", row, column: STATE_COL, oldValue: "active", newValue }, h.deps as never);
  }

  for (const [label, grid, event] of [
    ["null in the grid, null in the event", null, null],
    ["null in the grid, an empty string in the event", null, ""],
    ["an empty string in the grid, null in the event", "", null],
    ["spaces in the grid, null in the event", "  ", null],
  ] as const) {
    it(`notes the blank cell (${label}) and writes nothing else: blank values are the same blank, not a stale row`, () => {
      const h = harness(build(TWO));
      const r = clear(h, 1, grid, event);
      expect(r).toEqual({ handled: false });
      expect(noteOf(h.ss, 1)).toMatch(BLANK_WORDING);
      // Not mistaken for a sort (which would run the full repair and rewrite every item's Status):
      expect(itemRow(h.ss, "Tech", "I-0001").Status).toBe("Stale status");
      expect(itemRow(h.ss, "Tech", "I-0002").Status).toBe("Stale status");
      expect(stamp(h.ss, 2)).toBeNull();
      expect(claimsTab(h.ss).notes).toHaveLength(1);
    });
  }

  it("takes the lock for the note, then flushes, clears the cache and releases once", () => {
    const h = harness(build(TWO));
    clear(h, 1, null, null);
    const e = h.events;
    expect(e.indexOf("write")).toBeGreaterThan(e.indexOf("waitLock"));
    expect(e.indexOf("flush")).toBeGreaterThan(e.lastIndexOf("write"));
    expect(e.indexOf(`cache:${CATALOGUE_CACHE_KEY}`)).toBeGreaterThan(e.lastIndexOf("write"));
    expect(e.indexOf("releaseLock")).toBeGreaterThan(e.indexOf("flush"));
    expect(e.filter((x) => x === "releaseLock")).toHaveLength(1);
  });

  it("writes no note when the cell was cleared on a row with no Claim ID", () => {
    const h = harness(build(TWO));
    const row = addRowWithoutId(h.ss, "active");
    claimsTab(h.ss).grid[row - 1]![STATE_COL - 1] = null;
    h.events.length = 0;
    const r = onClaimsEdit(h.ss, { tab: "Claims", row, column: STATE_COL, oldValue: "active", newValue: null }, h.deps as never);
    expect(r).toMatchObject({ handled: false });
    expect(claimsTab(h.ss).getNote(row, STATE_COL)).toBeNull();
    expect(h.events).not.toContain("write");
  });

  it("a later valid State on that cell removes the blank note (it is ours)", () => {
    const h = harness(build(TWO));
    clear(h, 1, null, null);
    expect(noteOf(h.ss, 1)).not.toBeNull();
    const r = h.edit(1, "active", { oldValue: null });
    expect(r).toEqual({ handled: true, reverted: false });
    expect(noteOf(h.ss, 1)).toBeNull();
  });
});

describe("a typo'd State on a row with no Claim ID gets no note (S-15 QA re-check coverage gap)", () => {
  it("recalculateAll does not note it", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }]));
    const row = addRowWithoutId(h.ss, "Sold ");
    h.recalc();
    expect(claimsTab(h.ss).getNote(row, STATE_COL)).toBeNull();
  });

  it("onClaimsEdit ignores it: nothing is written and no lock is taken (a row without a Claim ID is not ours)", () => {
    const h = harness(build([{ id: 1, item: "I-0001" }]));
    const row = addRowWithoutId(h.ss, "Sold ");
    const r = onClaimsEdit(h.ss, { tab: "Claims", row, column: STATE_COL, oldValue: "active", newValue: "Sold " }, h.deps as never);
    expect(r).toMatchObject({ handled: false });
    expect(claimsTab(h.ss).getNote(row, STATE_COL)).toBeNull();
    expect(h.events).not.toContain("write");
  });
});

// ---- F9: the edited row is confirmed by its Claim ID

describe("onClaimsEdit: confirming the edited row by Claim ID (S-15 QA re-check F9)", () => {
  // Item A (I-0001, qty 1): claim 1 holds (stamped), claim 2 waits. Item B (I-0002, qty 3): claim 3 was released earlier.
  // Claim 3's State is already "released", which is what the seller types for claim 1: the old State-only check cannot see a sort.
  const SEED: SeedClaim[] = [{ id: 1, item: "I-0001", promoted: STAMP }, { id: 2, item: "I-0001" }, { id: 3, item: "I-0002", state: "released" }];

  /** The seller releases claim 1 and sorts Claims by Claim ID descending; the trigger then runs with the pre-sort row. */
  function releaseThenSort(h: Harness, claimId?: number) {
    const t = claimsTab(h.ss);
    const row = rowOfClaim(h.ss, 1);
    t.grid[row - 1]![STATE_COL - 1] = "released";
    t.grid = [t.grid[0]!, ...t.grid.slice(1).sort((a, b) => Number(b[0]) - Number(a[0]))];
    expect(t.grid[row - 1]![0]).toBe(3); // premise: the edited row now holds claim 3, whose State is the same word
    expect(t.grid[row - 1]![STATE_COL - 1]).toBe("released");
    const event = { tab: "Claims", row, column: STATE_COL, oldValue: "active", newValue: "released", ...(claimId === undefined ? {} : { claimId }) };
    return onClaimsEdit(h.ss, event as never, h.deps as never);
  }

  it("when the Claim ID on the row is not the one the trigger saw, runs the full repair (one lock) and invents no promotion", () => {
    const h = harness(build(SEED));
    const r = releaseThenSort(h, 1);
    expect(r).toEqual({ handled: true, reverted: false });
    // Full repair signals: the edited claim's item is rewritten from the grid, and so is the OTHER item.
    expect(itemRow(h.ss, "Tech", "I-0001")).toMatchObject({ Status: "Reserved", Person: "Buyer 2" });
    expect(itemRow(h.ss, "Tech", "I-0002").Status).toBe("Available");
    expect(stamp(h.ss, 2)).toBeNull(); // D-039: a repair with no before-state invents no promotion
    expect(h.events.filter((x) => x === "waitLock")).toHaveLength(1);
    expect(h.events.filter((x) => x === "releaseLock")).toHaveLength(1);
  });

  it("does not treat the row's new occupant as the edited claim (no sale check, no note on it)", () => {
    const h = harness(build(SEED));
    releaseThenSort(h, 1);
    expect(noteOf(h.ss, 3)).toBeNull();
    expect(stateOf(h.ss, 3)).toBe("released");
  });

  it("when the Claim ID matches, it is an ordinary edit: the waiter is stamped and only the edited item is rewritten", () => {
    const h = harness(build(SEED));
    const r = h.edit(1, "released", { claimId: 1 });
    expect(r).toEqual({ handled: true, reverted: false });
    expect(stamp(h.ss, 2)).toBe(NOW);
    expect(itemRow(h.ss, "Tech", "I-0002").Status).toBe("Stale status");
  });

  it("when the row no longer holds any Claim ID, the claim cannot be confirmed: full repair", () => {
    const h = harness(build(SEED));
    const t = claimsTab(h.ss);
    const row = rowOfClaim(h.ss, 1);
    // Claim 1 (now released) moved to the end of the tab; an id-less row with the same State took its place.
    const moved = t.grid[row - 1]!.map((v, i) => (i === STATE_COL - 1 ? "released" : v));
    t.grid[row - 1] = CLAIM_HEADERS.map((hd) => (hd === "State" ? "released" : null));
    t.grid.push(moved);
    const r = onClaimsEdit(h.ss, { tab: "Claims", row, column: STATE_COL, oldValue: "active", newValue: "released", claimId: 1 } as never, h.deps as never);
    expect(r).toEqual({ handled: true, reverted: false });
    expect(itemRow(h.ss, "Tech", "I-0002").Status).toBe("Available"); // the other item was repaired too
    expect(stamp(h.ss, 2)).toBeNull();
  });

  it("without a claimId the earlier State-comparison still applies (backwards compatible)", () => {
    const h = harness(build(SEED));
    const r = h.edit(1, "released");
    expect(r).toEqual({ handled: true, reverted: false });
    expect(stamp(h.ss, 2)).toBe(NOW);
  });
});

// ---- F10: clear only our own notes

describe("onClaimsEdit: an accepted edit clears only our own notes (S-15 QA re-check F10)", () => {
  const TWO: SeedClaim[] = [{ id: 1, item: "I-0001", promoted: STAMP }, { id: 2, item: "I-0001" }];

  it("leaves a note the seller wrote herself on the State cell", () => {
    const h = harness(build(TWO));
    claimsTab(h.ss).setNote(rowOfClaim(h.ss, 1), STATE_COL, "Neighbour will collect on Sunday");
    const r = h.edit(1, "released");
    expect(r).toEqual({ handled: true, reverted: false });
    expect(noteOf(h.ss, 1)).toBe("Neighbour will collect on Sunday");
    expect(stamp(h.ss, 2)).toBe(NOW); // the edit itself was still fully handled
  });

  it("leaves the seller's own note on a sale that is accepted, too", () => {
    const h = harness(build(TWO));
    claimsTab(h.ss).setNote(rowOfClaim(h.ss, 1), STATE_COL, "Paid in cash");
    h.edit(1, "sold");
    expect(noteOf(h.ss, 1)).toBe("Paid in cash");
    expect(stateOf(h.ss, 1)).toBe("sold");
  });

  it("still removes the typo note (NOT_A_STATE) when the cell becomes valid", () => {
    const h = harness(build(TWO));
    h.edit(1, "Sold ");
    expect(noteOf(h.ss, 1)).toBe(NOT_A_STATE);
    h.edit(1, "sold", { oldValue: "Sold " });
    expect(noteOf(h.ss, 1)).toBeNull();
  });

  it("still removes a sale-refusal reason once a later edit of that cell is accepted", () => {
    // Quantity 1, claim 1 already sold: marking claim 2 sold is refused with a reason in a note.
    const h = harness(build([{ id: 1, item: "I-0001", state: "sold", soldPrice: 2500, soldAt: STAMP }, { id: 2, item: "I-0001" }]));
    const refused = h.edit(2, "sold");
    expect(refused).toMatchObject({ handled: true, reverted: true });
    expect(noteOf(h.ss, 2)).not.toBeNull();
    const accepted = h.edit(2, "released", { oldValue: "active" });
    expect(accepted).toEqual({ handled: true, reverted: false });
    expect(noteOf(h.ss, 2)).toBeNull();
  });

  it("does not remove a seller's note that merely resembles nothing of ours, even when the same cell had a refusal earlier", () => {
    const h = harness(build([{ id: 1, item: "I-0001", state: "sold", soldPrice: 2500, soldAt: STAMP }, { id: 2, item: "I-0001" }]));
    h.edit(2, "sold"); // refused, our note
    claimsTab(h.ss).setNote(rowOfClaim(h.ss, 2), STATE_COL, "Call before she comes"); // the seller replaces it with her own
    h.edit(2, "released", { oldValue: "active" });
    expect(noteOf(h.ss, 2)).toBe("Call before she comes");
  });
});
