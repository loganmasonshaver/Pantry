// Manual auth check for functions with `verify_jwt = false` in config.toml.
// We disable the platform's JWT gateway because it doesn't verify ES256
// asymmetric-signed tokens (throws UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM).
// supabase-js on the server DOES verify ES256 via JWKS, so we use it manually.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!

/**
 * Verifies the Authorization header on an incoming request.
 * Returns the authenticated user's id + email on success, or null if invalid.
 */
export async function verifyUser(req: Request): Promise<{ id: string; email: string | null } | null> {
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization")
  if (!authHeader) return null

  const token = authHeader.replace(/^Bearer\s+/i, "").trim()
  if (!token) return null

  // Use the anon key client with the user's token — supabase-js handles ES256 via JWKS
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data?.user) return null

  return { id: data.user.id, email: data.user.email ?? null }
}

/** Standard 401 response when auth fails. */
export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  })
}
