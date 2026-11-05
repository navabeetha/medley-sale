// Synthetic staging fixture for S-03. All names and numbers are invented.
// SELLER_NUMBER stands in for the seller's number; the code under test never
// sees it as a parameter, so it must treat any phone-like string as a number.
import { FakeSpreadsheet } from "./fake-sheet";

export const SELLER_NUMBER = "+91 90000 00001";
export const BUYER_NAMES = ["Asha Testperson", "Ravi Samplename", "Meena Fixture"];
export const FORMULA_NAME = '=IMPORTXML("https://example.invalid","//a")';
export const ORIGINALS = [SELLER_NUMBER, "+919000000001", "90000 00001", ...BUYER_NAMES, FORMULA_NAME];

// Existing columns A to J (brief 4.1: ID and Quantity go in K and L).
export const ITEM_HEADERS = [
  "Item", "Brand", "Category", "Price", "Available from",
  "Status", "Person", "Notes", "Photo", "Link",
];
// Books: Person and Status swapped and Author before the name column, to prove
// columns are found by header name and never by position.
export const BOOK_HEADERS = [
  "Person", "Status", "Item", "Author", "Price",
  "Available from", "Category", "Notes", "Photo", "Link",
];

const row = (
  item: string, price: number | null, from: Date | string | null,
  status: string, person: string | null,
) => [item, "BrandX", "Cat", price, from, status, person, null, null, null];
const bookRow = (
  item: string, price: number | null, status: string, person: string | null,
) => [person, status, item, "Author Q", price, "Now", "Books", null, null, null];

export const DEC_2 = new Date(Date.UTC(2026, 11, 2));

/** Every status, a blank price, a real date cell, a hostile name (no quantity column yet). */
export function buildStaging(title = "A44 Garage Sale BUILD COPY"): FakeSpreadsheet {
  const ss = new FakeSpreadsheet(title);
  ss.withTab("README", [
    ["Garage sale notes"],
    [`WhatsApp ${SELLER_NUMBER}`],
    ["Open 10 to 5, prices from 100"],
    ["Or call +919000000001"],
    ["Backup 90000 00001"],
  ]);
  const tech = ss.withTab("Tech", [
    [...ITEM_HEADERS],
    row("Echo Dot", 2500, "Now", "Available", null),
    row("Tripod", 800, "Now", "Reserved", "Asha Testperson"),
    row("Camera", 4000, "Now", "Sold", "Ravi Samplename"),
    row("Lamp", 300, "Now", "Reserved", FORMULA_NAME),
  ]);
  tech.comments = [{ row: 3, col: 7 }, { row: 4, col: 7 }];
  ss.withTab("Gym & Sport", [
    [...ITEM_HEADERS],
    row("Yoga mat", null, "Now", "Available", null),
    row("Dumbbell pair", 1200, "Now", "Sold", "Meena Fixture"),
  ]);
  ss.withTab("Home Things", [
    [...ITEM_HEADERS],
    [...row("Picture frame", 200, "Now", "Available", null).slice(0, 10)],
  ]);
  const books = ss.withTab("Books", [
    [...BOOK_HEADERS],
    bookRow("Free Fall", null, "Available", null),
    bookRow("Night Garden", 150, "Reserved", "Meena Fixture"),
    bookRow("Slow Rivers", 120, "Sold", "Asha Testperson"),
    bookRow("Tiny Atlas", 90, "Available", null),
  ]);
  books.comments = [{ row: 2, col: 4 }];
  // A real date cell in "Available from" and a blank one.
  books.grid[4]![5] = DEC_2;
  books.grid[1]![5] = null;
  ss.withTab("Template", [
    [...ITEM_HEADERS],
    ["Example item", "BrandX", "Cat", 100, "Now", "Available", null, null, null, null],
  ]);
  return ss;
}
