// Manual auth check for functions with `verify_jwt = false` in config.toml.
// We disable the platform's JWT gateway because it doesn't verify ES256
// asymmetric-signed tokens (throws UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM).
// supabase-js on the server DOES verify ES256 via JWKS, so we use it manually.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5"

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!

// Cache the project's signing keys and verify the ES256 token IN-PROCESS, avoiding a
// network round-trip to the Auth service on every authenticated request. createRemoteJWKSet
// fetches once and caches (with its own rotation handling). On any local-verify miss we fall
// back to the network getUser path below, so this can never lock out a valid user.
const JWKS = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`))

async function networkVerify(token: string): Promise<{ id: string; email: string | null } | null> {
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data?.user) return null
  return { id: data.user.id, email: data.user.email ?? null }
}

/**
 * Verifies the Authorization header on an incoming request.
 * Returns the authenticated user's id + email on success, or null if invalid.
 */
export async function verifyUser(req: Request): Promise<{ id: string; email: string | null } | null> {
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization")
  if (!authHeader) return null

  const token = authHeader.replace(/^Bearer\s+/i, "").trim()
  if (!token) return null

  // Fast path: verify signature + expiry locally against the cached JWKS (no network).
  try {
    const { payload } = await jwtVerify(token, JWKS)
    if (payload.sub) return { id: payload.sub, email: (payload.email as string) ?? null }
  } catch (_e) {
    // Signature/JWKS miss (e.g. HS256 token, key-rotation race) — fall through to network.
  }

  // Fallback: authoritative network check (also covers token types JWKS can't verify).
  return await networkVerify(token)
}

/** Standard 401 response when auth fails. */
export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  })
}
