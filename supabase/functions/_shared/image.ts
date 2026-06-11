// Server-side backstop on inbound base64 image size. The clients all downscale to
// ~2048px before upload (≈300–800KB → ≈400KB–1.1MB base64), but a modified/abusive
// client can bypass that and POST a multi-MB body straight to the paid vision call.
// Frequency caps (scan-cap) bound how OFTEN that happens; this bounds how BIG each one
// is — together they cap the worst-case cost/latency of a single forged request.
// 10MB of base64 ≈ 7.5MB binary — far above any legitimate downscaled photo, so real
// users never trip it while egregious payloads are rejected before reaching OpenAI/Gemini.
export const MAX_IMAGE_BASE64_CHARS = 10_000_000

// Reject an oversized base64 image. Returns an error Response (caller should early-return
// it) or null when the image is within bounds. `label` only flavors the log line.
export function rejectOversizeImage(base64: unknown, label = "image"): Response | null {
  if (typeof base64 === "string" && base64.length > MAX_IMAGE_BASE64_CHARS) {
    console.log(`[${label}] rejected oversize base64: ${Math.round(base64.length / 1024)}KB`)
    return new Response(
      JSON.stringify({ error: "Image too large" }),
      { status: 413, headers: { "Content-Type": "application/json" } },
    )
  }
  return null
}
