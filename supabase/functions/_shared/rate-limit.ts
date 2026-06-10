// Simple in-memory rate limiter for Edge Functions
// Tracks requests per IP per minute. Resets on cold start — acceptable here because
// Supabase Edge Functions spin up fresh containers frequently and we'd rather under-limit
// (a few extra requests on rotation) than maintain a Redis dependency for this scale.

// Per-key counter. NOTE: still per-isolate (Supabase runs many), so this is burst
// protection only — the real abuse ceilings are the DB-backed per-user daily caps
// (scan-cap) + premium enforcement. Prefer keying on a trustworthy identity (user id)
// over a client-spoofable IP wherever the caller is authenticated.
const requests = new Map<string, { count: number; resetAt: number }>()

// Trustworthy client identifier for IP-based limiting. cf-connecting-ip is set by the
// edge proxy and can't be spoofed; x-forwarded-for CAN be padded with fake IPs by the
// caller, so we only ever take its first hop as a fallback — never the whole header.
export function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return cf.trim()
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return 'unknown'
}

// Periodically drop expired entries so a long-lived isolate doesn't grow unbounded.
let lastSweep = 0
function sweep(now: number) {
  if (now - lastSweep < 60000) return
  lastSweep = now
  for (const [k, v] of requests) if (now > v.resetAt) requests.delete(k)
}

export function rateLimit(
  ip: string,
  maxRequests: number = 20,
  windowMs: number = 60000
): { allowed: boolean; remaining: number } {
  const now = Date.now()
  sweep(now)
  const key = ip

  const entry = requests.get(key)
  // Fixed-window (not sliding): once the window expires, reset entirely. Slightly more
  // forgiving than sliding-window at window boundaries, which is fine for this use case.
  if (!entry || now > entry.resetAt) {
    requests.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: maxRequests - 1 }
  }

  entry.count++
  if (entry.count > maxRequests) {
    return { allowed: false, remaining: 0 }
  }

  return { allowed: true, remaining: maxRequests - entry.count }
}

export function getRateLimitHeaders(remaining: number, limit: number): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
  }
}

export function rateLimitResponse(): Response {
  return new Response(
    JSON.stringify({ error: 'Too many requests. Please try again later.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '60',
      },
    }
  )
}
