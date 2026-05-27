// Simple in-memory rate limiter for Edge Functions
// Tracks requests per IP per minute. Resets on cold start — acceptable here because
// Supabase Edge Functions spin up fresh containers frequently and we'd rather under-limit
// (a few extra requests on rotation) than maintain a Redis dependency for this scale.

// Per-IP counter. Map entries are never explicitly evicted — relying on cold-start
// recycling to prevent unbounded growth.
const requests = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(
  ip: string,
  maxRequests: number = 20,
  windowMs: number = 60000
): { allowed: boolean; remaining: number } {
  const now = Date.now()
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
