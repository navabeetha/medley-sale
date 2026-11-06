// SITE_URL, the Script Property the private booking link points at (brief 2.8, 4.3). Shared by reserve
// and the seller-sheet handlers so both accept exactly the same values (S-11 QA F3, R3).

/**
 * QA F3: the private link needs an absolute https URL with a host and no userinfo (`[^\s/?#@]+` rules out
 * `user@host`). A regex, not `new URL`: URL is not available in Apps Script V8.
 */
const SITE_URL_PATTERN = /^https:\/\/[^\s/?#@]+(?:[/?#]\S*)?$/;

/**
 * R3: a pasted trailing space or newline must not switch things off, so trim first.
 * Returns the trimmed URL, or null when it is missing or unusable.
 */
export function cleanSiteUrl(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  return SITE_URL_PATTERN.test(s) ? s : null;
}
