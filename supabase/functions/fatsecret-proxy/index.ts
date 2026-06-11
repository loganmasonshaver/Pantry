import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'

const BASE_URL = "https://platform.fatsecret.com/rest/server.api"
const CONSUMER_KEY = Deno.env.get("FATSECRET_KEY") ?? ""
const CONSUMER_SECRET = Deno.env.get("FATSECRET_SECRET") ?? ""

// Allowlist of FatSecret methods this proxy will sign, with the exact params each
// accepts. The proxy holds the consumer secret, so without this a caller could pass
// ANY method/params and have us sign arbitrary FatSecret API calls on our account.
// Unknown methods are rejected; unexpected params are stripped before signing.
const ALLOWED_METHODS: Record<string, Set<string>> = {
  "foods.search": new Set(["search_expression", "page_number", "max_results"]),
  "food.get": new Set(["food_id"]),
  "foods.autocomplete": new Set(["expression", "max_results"]),
}

// OAuth 1.0a requires stricter percent-encoding than standard encodeURIComponent
function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A")
}

function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, "")
}

async function buildSignedUrl(params: Record<string, string>): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: CONSUMER_KEY,
    oauth_nonce: generateNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)), // OAuth requires Unix timestamp in seconds
    oauth_version: "1.0",
    format: "json",
    ...params,
  }

  // OAuth 1.0a signature requires parameters sorted alphabetically
  const sortedKeys = Object.keys(oauthParams).sort()
  const paramString = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join("&")

  // signature base string format: METHOD & encoded_url & encoded_params
  const signatureBase = ["GET", percentEncode(BASE_URL), percentEncode(paramString)].join("&")

  const signingKey = `${percentEncode(CONSUMER_SECRET)}&` // trailing & is required; empty token secret for consumer-only requests
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  )
  const signatureBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(signatureBase))
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)))

  oauthParams["oauth_signature"] = signatureB64

  const queryString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join("&")

  return `${BASE_URL}?${queryString}`
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    })
  }

  // Manual auth check — gateway JWT verification is disabled (ES256 incompatibility)
  const user = await verifyUser(req)
  if (!user) return unauthorizedResponse()

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown'
  const { allowed } = rateLimit(ip, 30, 60000) // 30 FatSecret requests per minute per IP
  if (!allowed) return rateLimitResponse()

  try {
    const { method, params } = await req.json() as {
      method: string
      params: Record<string, string>
    }

    const allowedParams = method ? ALLOWED_METHODS[method] : undefined
    if (!allowedParams) {
      return new Response(JSON.stringify({ error: "Unsupported method" }), { status: 400 })
    }

    // Strip anything not on this method's param allowlist so a caller can't smuggle
    // extra signed params (e.g. a different format/region) into our account's request.
    const safeParams: Record<string, string> = {}
    for (const [k, v] of Object.entries(params ?? {})) {
      if (allowedParams.has(k)) safeParams[k] = String(v)
    }

    const url = await buildSignedUrl({ method, ...safeParams })
    const res = await fetch(url)
    const data = await res.json()

    if (data.error) {
      return new Response(JSON.stringify({ error: data.error.message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
})
