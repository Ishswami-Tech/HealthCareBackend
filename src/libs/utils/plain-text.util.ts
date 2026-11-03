/**
 * Plain-text normalisation for free-text profile fields (names, address, city,
 * state, family member names, review comments).
 *
 * Profile fields used to store raw markup verbatim (`<img src=x onerror=...>`,
 * `"><script>...</script>`, `<svg/onload=...>`). Every web view escapes them, but
 * PDFs, emails, WhatsApp templates and print views are other sinks, so the
 * markup is removed at the DTO layer instead of trusting every renderer.
 *
 * Deliberately conservative:
 * - Only tag-shaped sequences are removed: `<` immediately followed by a
 *   letter, `/`, `!` or `?`. `a < b`, `I <3 Pune` and `5<6` are kept.
 * - The text inside removed elements is kept ("<b>Ravi</b>" -> "Ravi"), except
 *   for <script>/<style> blocks whose content is code, not a name.
 * - Apostrophes, quotes, ampersands, accents, Devanagari, Arabic/Hebrew (RTL)
 *   and emoji are untouched. Nothing is HTML-escaped (that is the renderer's job;
 *   escaping here would show `&#39;` in names like O'Brien).
 * - Bidi embedding/override controls (U+202A-U+202E) are removed: they can make
 *   a stored value display differently from what it contains ("Trojan Source").
 *   Isolates and LRM/RLM marks, which RTL text legitimately uses, are kept.
 * - Other C0/C1 control characters are removed; newlines and tabs are kept.
 */

const SCRIPT_OR_STYLE_BLOCK = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
// A tag: "<" + letter, "/", "!" or "?" ... up to the next ">" (or end of input for an unclosed tag).
const HTML_TAG = /<[/!?]?[a-zA-Z][^<>]*(?:>|$)|<[/!?][^<>]*(?:>|$)/g;
const TAB = 0x09;
const LINE_FEED = 0x0a;

/** C0/C1 control characters (except tab and newline) and bidi embedding/override controls. */
function isStrippedCodePoint(codePoint: number): boolean {
  if (codePoint === TAB || codePoint === LINE_FEED) return false;
  if (codePoint <= 0x1f) return true; // C0 controls
  if (codePoint >= 0x7f && codePoint <= 0x9f) return true; // DEL + C1 controls
  return codePoint >= 0x202a && codePoint <= 0x202e; // LRE, RLE, PDF, LRO, RLO
}

function removeControlCharacters(input: string): string {
  let output = '';
  for (const character of input) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (!isStrippedCodePoint(codePoint)) {
      output += character;
    }
  }
  return output;
}

const COLLAPSIBLE_SPACES = /[ \t]{2,}/g;

/** Removes HTML/XML markup and unsafe control characters from a string. */
export function stripHtmlTags(input: string): string {
  const withoutMarkup = input
    .replace(/\r\n?/g, '\n')
    .replace(SCRIPT_OR_STYLE_BLOCK, '')
    .replace(HTML_COMMENT, '')
    .replace(HTML_TAG, '');
  return removeControlCharacters(withoutMarkup);
}

/** stripHtmlTags + trim + collapse runs of spaces left behind by removed tags. */
export function toPlainText(input: string): string {
  return stripHtmlTags(input).replace(COLLAPSIBLE_SPACES, ' ').trim();
}

/**
 * class-transformer `@Transform` callback: plain-text for strings, anything else
 * passes through unchanged so class-validator still reports a wrong type.
 */
export function plainTextTransform<T>({ value }: { value: T }): T | string {
  return typeof value === 'string' ? toPlainText(value) : value;
}
