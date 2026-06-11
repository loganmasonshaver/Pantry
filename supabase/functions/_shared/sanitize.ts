// Sanitize user-supplied strings before they're interpolated into LLM prompts.
// Without this, arbitrary newlines/quotes enable prompt injection ("ignore previous
// instructions…") and unbounded length enables token-bloat DoS. Output is also
// JSON-validated downstream, but defense-in-depth keeps the prompt itself clean.

// Collapse whitespace, strip quotes/control chars, and cap length on one string.
export function sanitizeStr(s: unknown, maxLen = 80): string {
  return String(s ?? "")
    .replace(/[\r\n\t]+/g, " ")  // no line breaks → can't inject new prompt directives
    .replace(/["'`]/g, "")        // strip quotes that could break out of the interpolation
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen)
}

// Cap array size AND per-element length; drop empties. For preference/dislike lists.
export function sanitizeList(arr: unknown, maxItems = 20, maxLen = 60): string[] {
  if (!Array.isArray(arr)) return []
  return arr.slice(0, maxItems).map((x) => sanitizeStr(x, maxLen)).filter(Boolean)
}
