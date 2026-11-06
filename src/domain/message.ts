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
  if (!u.detail) return u.name;
  return u.isBook ? `${u.name} by ${u.detail}` : `${u.name} (${u.detail})`;
}

export function buildMessage(buyerName: string, units: MessageUnit[], siteUrl: string, token: string): string {
  const out = [`Hi! I'm ${buyerName.replace(/\s+/g, " ")}.`];

  // Reserved: one bullet per item, however many units ("× 2", price "each").
  const held = new Map<string, { unit: MessageUnit; count: number }>();
  for (const u of units.filter((x) => x.outcome === "holder")) {
    const g = held.get(u.itemId);
    if (g) g.count++;
    else held.set(u.itemId, { unit: u, count: 1 });
  }
  if (held.size) {
    out.push("", "Reserved for me:");
    for (const { unit, count } of held.values()) {
      const price = unit.price === null ? "" : `, ${rupees(unit.price)}${count > 1 ? " each" : ""}`;
      out.push(`• ${title(unit)}${count > 1 ? ` × ${count}` : ""}${price}`);
    }
  }

  // Waiting: one bullet per unit, because each has its own place in line.
  const waiting = units.filter((x) => x.outcome === "waiting");
  if (waiting.length) {
    out.push("", "On the waiting list:");
    for (const u of waiting) {
      out.push(`• ${title(u)}${u.price === null ? "" : `, ${rupees(u.price)}`} (${ordinal(u.position ?? 1)} in line)`);
    }
  }

  out.push("", `Change or back out: ${siteUrl.replace(/\/+$/, "")}/#/b/${token}`);
  return out.join("\n");
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
  return [`Hi ${buyerName.replace(/\s+/g, " ")}!`, what, "", `Change or back out: ${siteUrl.replace(/\/+$/, "")}/#/b/${token}`].join("\n");
}
