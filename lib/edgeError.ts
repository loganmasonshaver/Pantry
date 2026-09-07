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


// A TRANSPORT failure — the request never completed a round trip — as opposed to the Edge Function
// answering with an error status. The distinction decides whether a completed batch is worth
// looking for: a non-2xx means the SERVER decided something (cap hit, bad input) and no finished
// work exists, while a transport failure says nothing at all about whether the work happened.
//
// The case this exists for is iOS suspending the network stack seconds after the user switches
// apps. The fetch dies; the Edge Function runs to completion, stores its result, increments the
// daily cap and bills OpenAI. supabase-js reports only "Failed to send a request to the Edge
// Function", which reads like a failure and is not one.
//
// Lives here rather than beside its caller because lib/meals.ts constructs a Supabase client at
// module load and cannot be imported by a plain node test. This module has no imports at all.
export function isTransportFailure(error: any): boolean {
  // supabase-js names the class; the message test is the fallback if that name ever changes.
  if (error?.name === 'FunctionsFetchError') return true
  if (typeof error?.context?.status === 'number') return false // the server answered — not transport
  return /failed to send a request/i.test(String(error?.message ?? ''))
}
