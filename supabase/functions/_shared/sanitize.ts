// Sanitize user-supplied strings before they're interpolated into LLM prompts.
// Without this, arbitrary newlines/quotes enable prompt injection ("ignore previous
// instructions…") and unbounded length enables token-bloat DoS. Output is also
// JSON-validated downstream, but defense-in-depth keeps the prompt itself clean.

// Cut a string to length WITHOUT splitting a UTF-16 surrogate pair.
//
// JS strings are UTF-16, so an emoji is two code units and slice/substring can land between them.
// The orphaned half is then serialized by JSON.stringify as a bare \udXXX escape. That is valid to
// JavaScript's own parser and REJECTED by strict ones: OpenAI answers "Invalid body: failed to
// parse JSON value" and the entire request is lost. It is why the trending pipeline's OpenAI
// fallback had never once worked — Gemini's endpoint is lenient and accepted the same body, so the
// break stayed invisible behind a provider that almost always succeeds.
//
// Not a theoretical edge case in this codebase. Creators use 🥚🥦🧄 as ingredient bullets — the
// parser's own BULLET_CHARS enumerates them — so YouTube descriptions are dense with astral-plane
// characters and a fixed-length cut has a real chance of landing inside one. The same applies to
// anything a USER types: a food dislike or item name with an emoji near the cap goes through
// sanitizeStr and straight into a prompt.
export function truncateSafe(s: string, maxLen: number): string {
  const cut = s.length > maxLen ? s.slice(0, maxLen) : s
  // A high surrogate not followed by a low, or a low not preceded by a high. Either is unpaired.
  return cut.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
}

// Collapse whitespace, strip quotes/control chars, and cap length on one string.
export function sanitizeStr(s: unknown, maxLen = 80): string {
  const cleaned = String(s ?? "")
    .replace(/[\r\n\t]+/g, " ")  // no line breaks → can't inject new prompt directives
    .replace(/["'`]/g, "")        // strip quotes that could break out of the interpolation
    .replace(/\s+/g, " ")
    .trim()
  return truncateSafe(cleaned, maxLen)
}

// Cap array size AND per-element length; drop empties. For preference/dislike lists.
export function sanitizeList(arr: unknown, maxItems = 20, maxLen = 60): string[] {
  if (!Array.isArray(arr)) return []
  return arr.slice(0, maxItems).map((x) => sanitizeStr(x, maxLen)).filter(Boolean)
}
