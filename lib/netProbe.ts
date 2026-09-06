import { perfMark } from './perf'
import { supabase } from './supabase'

// DEV-ONLY three-way discriminator for the cold-start latency in Logan's traces: Home's profile,
// pantry and logs queries START at ~745ms and DONE at ~11.2-11.9s, while Discover's start at
// ~6.2s — and every one of them completes between 11.2s and 12.4s. Finishing together regardless
// of when they started is not per-query latency; it is one shared gate releasing everything at once.
//
// The server is not it: curl from the dev machine gives TTFB 158-654ms against the same REST
// endpoint, warming to 158ms. So the wait is on the client, and there are two plausible gates:
//
//   A. supabase-js. Every PostgREST call awaits _getAccessToken() -> auth.getSession() to attach
//      the JWT, and that path reads AsyncStorage and may refresh the token over the network behind
//      a lock. A slow refresh stalls EVERY query in the app, which matches the release-together
//      shape exactly.
//   B. The device's own network. A wifi/cellular stall also releases everything at once, and would
//      look identical from inside supabase-js.
//
// These three marks separate them, and the ORDER of the answer is what matters, not the absolute
// numbers (Metro dev bundle — see perf.ts):
//   - raw REST slow too      -> B, the device network. Nothing to fix in app code.
//   - raw REST fast, getSession slow -> A, and specifically the auth refresh.
//   - both fast, query slow  -> A, but queuing/lock contention rather than the refresh itself.
//
// Deliberately fired at mount, CONCURRENTLY with the app's real queries: the hypothesis is
// contention, so probing a quiet moment afterwards would measure the wrong thing and come back
// clean.
export async function probeNetwork(): Promise<void> {
  if (!__DEV__) return
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) { perfMark('probe: SKIPPED (no env)'); return }

  // 1. Bare HTTPS, no supabase-js anywhere in the path. Anon key only, so this cannot itself
  //    trigger a session read and contaminate probe 2.
  perfMark('probe 1: raw REST start')
  try {
    await fetch(`${url}/rest/v1/trending_meals?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    perfMark('probe 1: raw REST done')
  } catch (e) {
    perfMark(`probe 1: raw REST FAILED ${(e as Error).message}`)
  }

  // 2. The gate every query in the app sits behind.
  perfMark('probe 2: getSession start')
  try {
    await supabase.auth.getSession()
    perfMark('probe 2: getSession done')
  } catch (e) {
    perfMark(`probe 2: getSession FAILED ${(e as Error).message}`)
  }

  // 3. Same shape as the app's own reads, so it is comparable to the Home/Discover marks.
  perfMark('probe 3: supabase query start')
  const { error } = await supabase.from('trending_meals').select('id').limit(1)
  perfMark(`probe 3: supabase query done${error ? ' (error: ' + error.message + ')' : ''}`)
}
