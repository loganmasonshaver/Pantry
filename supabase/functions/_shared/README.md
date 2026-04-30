# Edge function shared utilities

## Why `verify_jwt = false` + manual auth

This project uses **asymmetric JWT signing keys (ES256)** for Supabase Auth.
Supabase's edge function gateway currently only verifies HS256 tokens natively
and rejects ES256 tokens with `UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM` (401).

Fix: disable the platform's gateway JWT check (`verify_jwt = false` in
`supabase/config.toml`) and verify auth manually inside each function using
`supabase-js`, which supports ES256 via JWKS.

## Pattern for new edge functions

**1. Register the function in `supabase/config.toml`:**

```toml
[functions.your-new-function]
verify_jwt = false
```

**2. Import and call `verifyUser` at the start of the request handler:**

```ts
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'

Deno.serve(async (req: Request) => {
  // CORS preflight stays first (no auth needed)
  if (req.method === "OPTIONS") { /* ... */ }

  // Manual auth check — gateway JWT verification is disabled (ES256 incompatibility)
  const user = await verifyUser(req)
  if (!user) return unauthorizedResponse()

  // ... rate limit, body parsing, real logic below
})
```

**3. Deploy:**
```
supabase functions deploy your-new-function
```

## When Supabase fixes the gateway

Once Supabase's edge runtime natively verifies ES256 tokens:

1. Remove the `[functions.*] verify_jwt = false` entries from `config.toml`
2. Optionally remove the `verifyUser()` calls (or keep them as defense-in-depth)
3. Redeploy all functions

Track the upstream status: https://github.com/supabase/supabase/issues (search
"ES256" or "UNSUPPORTED_TOKEN_ALGORITHM").
