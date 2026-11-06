// S-04: the public catalogue (brief 4.3, 6.1; D-026, D-027, D-028, D-030).
// Pure logic over the Spreadsheet interface. This is the ONLY data that leaves
// the sheet without a token, so it is built field by field from an allow-list
// and never copies a row: nothing from Claims (beyond the counts the queue
// engine derives), Bookings or the Person column can reach the response (T-12).
import { findHeaderRow } from "./header-row";
import { itemNameCol } from "./migrate";
import type { CellValue, Spreadsheet, Tab } from "./sheet";
import { recalculate, type ClaimInput, type ClaimState } from "../domain/queue";

/** One item as the site sees it. Exactly these keys, see D-030 rule 1. */
export interface CatalogueItem {
  id: string;
  tab: string;
  name: string;
  brand: string | null;
  author: string | null;
  category: string | null;
  price: number | null;
  availableFrom: string | null;
  notes: string | null;
  link: string | null;
  quantity: number;
  unitsLeft: number;
  freeUnits: number;
  waitingCount: number;
  photos: number;
}

export interface CatalogueOptions {
  /** Photos per item ID (from the S-05 manifest). Missing means 0. */
  photoCounts?: Record<string, number>;
  /**
   * Turns a date cell into "YYYY-MM-DD" in the spreadsheet's time zone (D-030
   * rule 6). The Apps Script adapter must inject Utilities.formatDate, because
   * a midnight-IST date is the previous day in UTC. The default is the UTC date.
   */
  formatDate?: (d: Date) => string;
  /**
   * The seller's WhatsApp number, from Script Property SELLER_WHATSAPP (D-034
   * rule 4). It is never in the repo. Only a wa.me URL built from its digits
   * leaves this function; see contactUrl().
   */
  sellerWhatsapp?: string;
}

/**
 * Where availability comes from (D-035). "claims": the queue engine over the
 * Claims tab (D-030). "status": there is no Claims tab, so the item row's
 * Status column decides.
 */
type Mode = "claims" | "status";

/**
 * The published tabs, an allow-list (D-030 rule 9): a hidden, copied or new tab
 * is never published by accident. A new category needs a code change.
 */
export const ITEM_TABS = ["Tech", "Gym & Sport", "Home Things", "Books"];
const BOOKS = "Books";
/** Where the brand (or on Books, the book name) and its rich-text link live. */
const BRAND_HEADERS = ["Brand (+ Link)", "Brand"];

/** 1-based column of the first header matching one of `names`, or 0. */
function col(head: CellValue[], names: string[]): number {
  return head.findIndex((h) => typeof h === "string" && names.includes(h.trim())) + 1;
}

const blank = (v: CellValue | undefined): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Plain text of a cell, or null when blank. */
const text = (v: CellValue | undefined): string | null => (blank(v) ? null : String(v).trim());

const utcDate = (d: Date): string => d.toISOString().slice(0, 10);

/** A valid Date becomes "YYYY-MM-DD"; text such as "Now" passes through; an invalid Date is null (D-030 rule 6). */
function dateOrText(v: CellValue | undefined, formatDate: (d: Date) => string): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : formatDate(v);
  return text(v);
}

/** Links become hrefs on the site, so only http(s) survives (D-030 rule 5). */
function safeLink(url: string | undefined): string | null {
  // The adapter joins several link runs in one cell with a space; use the first.
  const first = url?.trim().split(/\s+/)[0];
  return first && /^https?:\/\//i.test(first) ? stripTracking(first) : null;
}

// D-037: ad/click tracking the seller picked up while shopping (e.g. Amazon's hvlocphy,
// a rough location code) shouldn't be republished. Amazon product pages live in the path
// (/dp/<ASIN>), so their whole query goes; elsewhere only known tracker names go, so a
// functional parameter (a product or region id) still works. Plain string parsing on
// purpose: the Apps Script runtime has no URL class.
// Real storefronts only: amazon.in, amazon.eg, amazon.com, amazon.com.au, amazon.co.uk.
// Not amazon.in.evil.example (QA D-037 F1).
const AMAZON_HOST = /(^|\.)amazon\.(?:com?\.)?[a-z]{2,3}$/i;
const TRACKER = /^(utm_\w+|gclid|gbraid|wbraid|dclid|gad_\w+|fbclid|msclkid|mc_cid|mc_eid|igshid|_ga|_gl|yclid|ttclid)$/i;

function stripTracking(link: string): string {
  const m = /^(https?:\/\/([^/?#]*)[^?#]*)(?:\?([^#]*))?(#.*)?$/i.exec(link);
  if (!m || m[3] === undefined) return link; // no query: nothing to strip
  const [, base, host, query, hash = ""] = m;
  const kept = AMAZON_HOST.test(host!.replace(/:\d+$/, ""))
    ? []
    : query!.split("&").filter((p) => p !== "" && !TRACKER.test(p.split("=")[0]!));
  return base + (kept.length ? `?${kept.join("&")}` : "") + hash;
}

/** Claims by header name (brief 4.1). Only Claim ID, Item ID and State are read. */
function readClaims(ss: Spreadsheet): ClaimInput[] {
  const grid = ss.getTab("Claims")?.getGrid() ?? [];
  const head = grid[0] ?? [];
  const idCol = col(head, ["Claim ID"]);
  const itemCol = col(head, ["Item ID"]);
  const stateCol = col(head, ["State"]);
  if (!idCol || !itemCol || !stateCol) return [];
  const out: ClaimInput[] = [];
  for (const r of grid.slice(1)) {
    const state = r[stateCol - 1];
    const itemId = text(r[itemCol - 1]);
    if (!itemId || (state !== "active" && state !== "released" && state !== "sold")) continue;
    // previousRole null: we only read the figures, we never promote anybody here.
    out.push({ claimId: Number(r[idCol - 1]), itemId, state: state as ClaimState, promotedAt: null, previousRole: null });
  }
  return out;
}

/**
 * https://wa.me/<digits> for a seller number, or null (D-036 rule 2). Spaces,
 * "+", "-" and brackets are stripped; any other character means the value is
 * not a phone number, so null. A leading "00" is dropped. The rest must be 11
 * to 15 digits with no leading 0 (the country code is required). An Indian
 * number (91...) must be exactly 12 digits with 6-9 after the 91, which rejects
 * a stray trunk 0 (+91 0...). Null means the site shows no reserve link rather
 * than a wrong one.
 */
export function contactUrl(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const stripped = raw.replace(/[\s+\-()[\]]/g, "");
  if (!/^\d+$/.test(stripped)) return null;
  const digits = stripped.replace(/^00/, "");
  if (!/^[1-9]\d{10,14}$/.test(digits)) return null;
  if (digits.startsWith("91") && !/^91[6-9]\d{9}$/.test(digits)) return null;
  return `https://wa.me/${digits}`;
}

/**
 * Status-mode availability (D-035). Statuses match ignoring case and surrounding spaces (D-036 rule 1) and fail closed:
 * Sold, blank and anything unrecognised return null (the row is left out).
 * Reserved holds the whole quantity, so freeUnits is 0.
 */
function statusAvailability(status: CellValue | undefined, q: number): { unitsLeft: number; freeUnits: number } | null {
  if (!Number.isInteger(q) || q < 1) return null; // D-026: an unusable Quantity hides the row
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (s === "available") return { unitsLeft: q, freeUnits: q };
  if (s === "reserved") return { unitsLeft: q, freeUnits: 0 };
  return null;
}

function tabItems(tab: Tab, mode: Mode, claims: ClaimInput[], photoCounts: Record<string, number>, formatDate: (d: Date) => string): CatalogueItem[] {
  const grid = tab.getGrid();
  const hr = findHeaderRow(grid);
  if (hr < 0) return [];
  const head = grid[hr]!;
  const nameCol = itemNameCol(tab, head);
  const idCol = col(head, ["ID"]);
  if (!nameCol || !idCol) return [];
  const isBooks = tab.name === BOOKS;
  const brandCol = isBooks ? 0 : col(head, BRAND_HEADERS);
  // The link sits on the brand cell, or on Books the book-name cell.
  const linkCol = isBooks ? nameCol : brandCol;
  const authorCol = isBooks ? col(head, ["Author"]) : 0;
  const categoryCol = col(head, ["Category"]);
  const priceCol = col(head, ["Price"]);
  const fromCol = col(head, ["Available from"]);
  const notesCol = col(head, ["Notes"]);
  const qtyCol = col(head, ["Quantity"]);
  const statusCol = col(head, ["Status"]); // read in status mode only; Person is never read
  const cell = (cells: CellValue[], c: number): CellValue | undefined => (c ? cells[c - 1] : undefined);
  const links = new Map(tab.getLinks().map((l) => [`${l.row}:${l.col}`, l.url]));

  const out: CatalogueItem[] = [];
  for (let r = hr + 1; r < grid.length; r++) {
    const cells = grid[r]!;
    const id = text(cells[idCol - 1]);
    const name = text(cells[nameCol - 1]);
    if (!id || !name) continue;
    const quantity = cell(cells, qtyCol);
    const q = typeof quantity === "number" ? quantity : NaN;
    let avail: { unitsLeft: number; freeUnits: number; waitingCount: number };
    if (mode === "status") {
      const a = statusAvailability(cell(cells, statusCol), q);
      if (!a) continue;
      avail = { ...a, waitingCount: 0 };
    } else {
      const calc = recalculate({ id, quantity: q }, claims, "");
      // Sold out is decided by Claims and Quantity, never the Status text (D-030 rule 4).
      if (calc.unavailable || calc.soldOut) continue;
      avail = calc;
    }
    const price = cell(cells, priceCol);
    out.push({
      id,
      tab: tab.name,
      name,
      brand: isBooks ? null : text(cell(cells, brandCol)),
      author: text(cell(cells, authorCol)),
      category: text(cell(cells, categoryCol)),
      price: typeof price === "number" ? price : null,
      availableFrom: dateOrText(cell(cells, fromCol), formatDate),
      notes: text(cell(cells, notesCol)),
      link: linkCol ? safeLink(links.get(`${r + 1}:${linkCol}`)) : null,
      quantity: q,
      unitsLeft: avail.unitsLeft,
      freeUnits: avail.freeUnits,
      waitingCount: avail.waitingCount,
      photos: photoCounts[id] ?? 0,
    });
  }
  return out;
}

export function catalogue(
  ss: Spreadsheet,
  opts: CatalogueOptions = {},
): { items: CatalogueItem[]; contactUrl: string | null; reserving: boolean } {
  const mode: Mode = ss.getTab("Claims") ? "claims" : "status";
  const claims = readClaims(ss);
  const photoCounts = opts.photoCounts ?? {};
  const formatDate = opts.formatDate ?? utcDate;
  const items = ss
    .getTabs()
    .filter((t) => ITEM_TABS.includes(t.name))
    .flatMap((t) => tabItems(t, mode, claims, photoCounts, formatDate));
  // D-038 rule 6: the site switches between browse-only and reserving from this flag.
  // It follows the Claims TAB, not its contents, so an empty Claims tab already means reserving.
  return { items, contactUrl: contactUrl(opts.sellerWhatsapp), reserving: mode === "claims" };
}
