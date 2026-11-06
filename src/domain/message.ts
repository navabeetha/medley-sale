// The WhatsApp reservation message (brief 2.8). Pure text building; the reserve
// handler decides who holds what, this only words it. The text is plain: the
// caller URL-encodes it. Names go in as typed (the apostrophe guard is a
// spreadsheet device only), but line breaks are flattened so a name cannot
// forge extra lines in the seller's chat.

/** One reserved or waiting unit, with what the message needs to describe its item. */
export interface MessageUnit {
  itemId: string;
  name: string;
  /** Brand, or on Books the author. */
  detail: string | null;
  isBook: boolean;
  price: number | null;
  outcome: "holder" | "waiting";
  position: number | null;
}

/** 1200 -> "₹1,200". Plain regex grouping: Apps Script's locale support is patchy. */
function rupees(price: number): string {
  const [whole, frac] = String(price).split(".");
  return `₹${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? `.${frac}` : ""}`;
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 21 -> "21st". */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** "Air purifier (Philips)": brand in parentheses after the name (S-13 seller note). Books: "Name by Author". */
export function title(u: MessageUnit): string {
  const name = flatten(u.name), detail = u.detail === null ? "" : flatten(u.detail);
  if (!name) return detail ? `Item${u.isBook ? " by " : " ("}${detail}${u.isBook ? "" : ")"}` : "Item";
  if (!detail) return name;
  return u.isBook ? `${name} by ${detail}` : `${name} (${detail})`;
}

/** Line breaks and runs of whitespace become one space, so typed text cannot start a new line in the chat. */
function flatten(s: string): string {
  // Lone surrogates become U+FFFD (a regex, not toWellFormed: Apps Script's V8 may lack it), or encodeURIComponent throws.
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD").replace(/\s+/g, " ").trim();
}

/** The message as sections: lines before the bullets stay; each bullet is a line that can be dropped. */
interface Part { text: string; bullet: boolean }

function messageParts(buyerName: string, units: MessageUnit[]): Part[] {
  const out: Part[] = [];
  const line = (text: string) => out.push({ text, bullet: false });
  const bullet = (text: string) => out.push({ text, bullet: true });
  line(`Hi! I'm ${flatten(buyerName)}.`);

  // Reserved: one bullet per item, however many units ("× 2", price "each").
  const held = new Map<string, { unit: MessageUnit; count: number }>();
  for (const u of units.filter((x) => x.outcome === "holder")) {
    const g = held.get(u.itemId);
    if (g) g.count++;
    else held.set(u.itemId, { unit: u, count: 1 });
  }
  if (held.size) {
    line("");
    line("Reserved for me:");
    for (const { unit, count } of held.values()) {
      const price = unit.price === null ? "" : `, ${rupees(unit.price)}${count > 1 ? " each" : ""}`;
      bullet(`• ${title(unit)}${count > 1 ? ` × ${count}` : ""}${price}`);
    }
  }

  // Waiting: one bullet per unit, because each has its own place in line.
  const waiting = units.filter((x) => x.outcome === "waiting");
  if (waiting.length) {
    line("");
    line("On the waiting list:");
    for (const u of waiting) {
      bullet(`• ${title(u)}${u.price === null ? "" : `, ${rupees(u.price)}`} (${ordinal(u.position ?? 1)} in line)`);
    }
  }
  return out;
}

const linkLine = (siteUrl: string, token: string): string => `Change or back out: ${siteUrl.replace(/\/+$/, "")}/#/b/${token}`;

/** The text with the first `keep` bullets (all when omitted); a "…and N more" line stands in for the rest. The link line is always last. */
function compose(parts: Part[], keep: number, siteUrl: string, token: string): string {
  const total = parts.filter((p) => p.bullet).length;
  let seen = 0;
  const shown = parts.filter((p) => !p.bullet || ++seen <= keep);
  while (shown.length > 1 && !shown[shown.length - 1]!.bullet && keep < total) shown.pop(); // no heading left without a bullet
  const lines = shown.map((p) => p.text);
  if (keep < total) lines.push(`…and ${total - keep} more`);
  lines.push("", linkLine(siteUrl, token));
  return lines.join("\n");
}

export function buildMessage(buyerName: string, units: MessageUnit[], siteUrl: string, token: string): string {
  const parts = messageParts(buyerName, units);
  return compose(parts, parts.length, siteUrl, token);
}

/** Brief 6.3: a wa.me URL must stay under this many characters (the longest allowed is one less). */
const URL_LIMIT = 2000;

/**
 * `${base}?text=<message>` under 2,000 characters. Too long: bullets are dropped from the end and "…and N more" says how
 * many, so the private link line is never what gets cut. Measured on the encoded text (emoji and ₹ cost 9 characters
 * or more each). Whole lines are dropped, so the URL never ends mid-escape.
 */
export function buildWhatsappUrl(base: string, buyerName: string, units: MessageUnit[], siteUrl: string, token: string): string {
  const parts = messageParts(buyerName, units);
  let keep = parts.filter((p) => p.bullet).length;
  for (;;) {
    const url = `${base}?text=${encodeURIComponent(compose(parts, keep, siteUrl, token))}`;
    if (url.length < URL_LIMIT || keep === 0) return url;
    keep--;
  }
}

/**
 * The seller's reply to one buyer, for the Message link column on Claims (brief 2.7). One unit:
 * what they hold (or their place in line) and their private link. Ends with the link line, like
 * the buyer's own message.
 */
export function buildSellerMessage(buyerName: string, unit: MessageUnit, siteUrl: string, token: string): string {
  const price = unit.price === null ? "" : `, ${rupees(unit.price)}`;
  const what = unit.outcome === "holder"
    ? `${title(unit)}${price} is reserved for you.`
    : `You are ${ordinal(unit.position ?? 1)} in line for ${title(unit)}${price}.`;
  return [`Hi ${flatten(buyerName)}!`, what, "", `Change or back out: ${siteUrl.replace(/\/+$/, "")}/#/b/${token}`].join("\n");
}
