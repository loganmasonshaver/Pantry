// supabase functions.invoke() puts a generic "Edge Function returned a non-2xx status code" on
// error.message, while the REAL server body ({ error, code }) lives on error.context (a Response).
// This unwraps it so the UI can tell the user WHY a call failed — especially deliberate gates like
// the daily cap ("Daily meal limit reached (3/day). Check back tomorrow.") — instead of a generic
// "it didn't work / try again". Returns a user-ready message plus the machine code (or null), so
// callers can also adapt behavior (e.g. hide a pointless "Try again" when the cap is hit).
export async function edgeErrorInfo(
  error: any,
  fallback = 'Something went wrong. Please try again.',
): Promise<{ message: string; code: string | null }> {
  let body: { error?: string; code?: string } = {}
  const ctx = error?.context
  try {
    // clone() when available so we don't consume a body a caller might also read.
    if (ctx?.clone) body = await ctx.clone().json()
    else if (ctx?.json) body = await ctx.json()
  } catch { /* body wasn't JSON — fall through to the generic paths */ }

  const rawMsg = typeof error?.message === 'string' ? error.message : ''
  let message: string
  if (body.error) message = body.error                       // server-provided, already user-ready
  else if (ctx?.status === 429) message = 'Too many requests right now — give it a moment and try again.'
  else if (rawMsg && !/non-2xx/i.test(rawMsg)) message = rawMsg // a real thrown message (not the opaque one)
  else message = fallback

  return { message, code: body.code ?? null }
}
