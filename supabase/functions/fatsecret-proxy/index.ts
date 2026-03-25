import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const BASE_URL = "https://platform.fatsecret.com/rest/server.api"
const CONSUMER_KEY = Deno.env.get("FATSECRET_KEY") ?? ""
const CONSUMER_SECRET = Deno.env.get("FATSECRET_SECRET") ?? ""

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
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    format: "json",
    ...params,
  }

  const sortedKeys = Object.keys(oauthParams).sort()
  const paramString = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join("&")

  const signatureBase = ["GET", percentEncode(BASE_URL), percentEncode(paramString)].join("&")

  const signingKey = `${percentEncode(CONSUMER_SECRET)}&`
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

  try {
    const { method, params } = await req.json() as {
      method: string
      params: Record<string, string>
    }

    if (!method) {
      return new Response(JSON.stringify({ error: "Missing method" }), { status: 400 })
    }

    const url = await buildSignedUrl({ method, ...params })
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
