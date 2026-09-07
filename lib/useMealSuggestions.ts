import { todayStr } from './localDate'
import { useState, useEffect, useRef, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { generateMeals, GeneratedMeal } from './meals'
import { generationKey, isGenerating, beginGeneration, endGeneration, publishGenerated, publishMealImage, subscribeGeneration } from './mealGenerationBus'
import { perfMark } from './perf'
import { prefetchMealImages } from '../components/MealImage'
import { takeCookNowPrefetch } from './mealPrefetch'
import { writeMealCache, mealCacheKey, CachedMeals as SharedCachedMeals } from './mealCache'
// Shared with the scan-time image warm — one implementation so the global image cache/cost model
// stays identical no matter who asks for an image.
import { fetchMealImage as fetchImage } from './mealImages'
import { useAIConsent } from '../context/AIConsentContext'

// Key and shape live in ./mealCache — see the note there on why there is exactly one of each.
const CACHE_KEY_PREFIX = 'pantry_daily_meals'
const RECENT_MEALS_KEY_PREFIX = 'pantry_recent_meal_names'  // last N gens of meal names, per mode, to suppress repeats

// Hard cap on user-initiated regens per day. The auto-fire on first daily visit is free
// (doesn't count); this cap only governs the manual "Refresh after shopping" button.
// The server's MEAL_GEN_CAP_PER_DAY, mirrored for DISPLAY ONLY — the real gate is
// check_and_increment_scan, which the client cannot reach around.
//
// This replaces a local MAX_DAILY_REGENS counter that drifted three ways and, on the path Logan
// actually used, drifted to zero: a Profile change regenerates through the effect rather than
// regenerate() so it never incremented, and the SAME change stales the meal cache — and the count
// was only restored on a cache HIT. So changing meal frequency both SPENT a server generation and
// REFILLED the client's allowance. It also lived in AsyncStorage, so a second device kept its own
// copy of one server number. The symptom: the Pantry refresh button said 0 of 3 used and was
// guaranteed to fail, because the server had counted 6 of 6.
const MEAL_GEN_CAP_PER_DAY = 6

// The quota row is keyed by Postgres current_date, i.e. UTC — NOT todayStr(), which is local and
// keys the meal cache. Using the local date here would read the wrong row for several hours a day.
function utcDayKey(): string { return new Date().toISOString().slice(0, 10) }

// How long the hero's own photo is waited for before today's meals are shown anyway. Only applies
// when meals are ALREADY on screen — see the block that uses it.
//
// 8000 was calibrated against the CACHED path, where fetchMealImage returns from AsyncStorage in
// ~50ms. A dish nobody has generated before has to be rendered by Flux first, which takes ~10s —
// so on the day-rollover cold start, the exact case this gate was written for, the timer always
// won and the swap it was meant to hold happened anyway: yesterday's photo out, shimmer in, for
// the remainder of the generation. Observed on device 2026-09-04.
//
// This is a BACKSTOP, not the expected path. fetchMealImage always settles — 3 attempts, 3s gaps,
// then null — so jobs[0] resolves on failure as well as success and the race normally ends there.
// The timer only matters if supabase.functions.invoke hangs without resolving, which is why it can
// sit well above a normal generation without risking a permanently pinned carryover.
const HERO_IMAGE_WAIT_MS = 22000

// userId stamps ownership so the cache survives sign-out (restored for the same user on
// re-login) without leaking to a different account on a shared device — reads that don't match
// the current user are treated as a miss. Absent userId = legacy/onboarding write, accepted.
type CachedMeals = SharedCachedMeals


export function useMealSuggestions(userId: string | undefined, isPremium: boolean, mode: 'cookNow' | 'mealPlan' = 'cookNow', enabled = true) {
  const { requestConsent } = useAIConsent()
  const [meals, setMeals] = useState<GeneratedMeal[]>([])
  // Whether anything is currently on screen. Decides whether a finished generation may swap in
  // immediately (nothing to disturb) or has to wait for its hero photo first.
  const shownRef = useRef(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Machine-readable reason alongside the human message, so the UI can adapt — e.g. suppress a
  // "Try again" that can't work once the daily cap ('meal_cap_reached') is hit.
  const [errorCode, setErrorCode] = useState<string | null>(null)
  // Track manual regens used today so the UI can disable the button at cap.
  // Mirrored to a ref so generate() can persist the right count without re-renders.
  // Generations the SERVER has counted today. null = not read yet; treat that as "allowed" so the
  // button is never disabled on missing information — the server rejects authoritatively anyway,
  // and now that Home and Pantry both render the reason, a rejection is explained rather than mute.
  const [genUsedToday, setGenUsedToday] = useState<number | null>(null)
  // Which (user, mode, day) we have already served from cache AND started an image backfill for.
  // Guards the effect against doing that work twice when `enabled` flips.
  const servedFromCacheRef = useRef<string | null>(null)
  // False until the disk cache has been read once. Home needs this to avoid flashing its
  // "Get tonight's meals" card for the ~100ms before the cache resolves — without it, every
  // launch shows the resting card and then yanks it away, which reads worse than a spinner.
  const [cacheChecked, setCacheChecked] = useState(false)
  // True while the meals on screen are a PREVIOUS day's, held up so the carousel has something
  // real in it during the 6-8s generation instead of a skeleton. The UI must label them — see the
  // note on the carryover branch below.
  const [stale, setStale] = useState(false)
  useEffect(() => { shownRef.current = meals.length > 0 }, [meals.length])

  const generate = async () => {
    if (!userId) return

    try {
      // DIAGNOSTIC: check session state before making any auth-required calls
      const sessionCheck = await supabase.auth.getSession()
      __DEV__ && console.log('[SESSION_CHECK v3]', {
        hasSession: !!sessionCheck.data?.session,
        userId: sessionCheck.data?.session?.user?.id,
        expires_at: sessionCheck.data?.session?.expires_at,
        expires_in_seconds: sessionCheck.data?.session?.expires_at
          ? sessionCheck.data.session.expires_at - Math.floor(Date.now() / 1000)
          : null,
        access_token_preview: sessionCheck.data?.session?.access_token?.slice(0, 40),
      })

      // If no session, try refreshing
      if (!sessionCheck.data?.session) {
        __DEV__ && console.log('[SESSION_CHECK v3] no session, attempting refresh...')
        const refreshed = await supabase.auth.refreshSession()
        __DEV__ && console.log('[SESSION_CHECK v3] refresh result', {
          hasSession: !!refreshed.data?.session,
          error: refreshed.error?.message,
        })
      }

      // Three INDEPENDENT reads. None feeds another, so they run together — they were sequential,
      // which spent two extra round trips (~150-250ms each, measured on this device) on the exact
      // path the user is watching a shimmer through. The GPT call after this dominates the wait,
      // which is precisely why the avoidable half-second before it should not be there.
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() // limits rating history fed to GPT so stale preferences don't bloat the prompt
      const [{ data: profile }, { data: pantryItems }, { data: ratings }] = await Promise.all([
        supabase
          .from('profiles')
          .select('calorie_goal, protein_goal, meals_per_day, cooking_skill, max_prep_minutes, dietary_restrictions, food_dislikes, cuisine_preferences, staples_excluded')
          .eq('id', userId)
          .single(),
        supabase
          .from('pantry_items')
          .select('name')
          .eq('user_id', userId)
          .eq('in_stock', true)
          .order('created_at', { ascending: true })
          .limit(200), // bound the list serialized into the GPT prompt (token cost + truncation risk)
        supabase
          .from('meal_ratings')
          .select('meal_name, rating')
          .eq('user_id', userId)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(100), // most-recent ratings only — bounds prompt size as history grows
      ])

      // Oldest items first — GPT prompt will prioritize using them up
      const ingredients = pantryItems?.map(i => i.name) || []

      const dislikedMeals = ratings?.filter(r => r.rating === -1).map(r => r.meal_name) ?? []
      const likedMeals = ratings?.filter(r => r.rating === 1).map(r => r.meal_name) ?? []

      // Suppress repeats from recent generations. This device-local copy is now only a redundancy
      // layer — the authoritative window lives in profiles.recent_meal_names and is enforced in
      // code by generate-meals, which is what actually stops a repeat the model tries to return.
      let recentMealNames: string[] = []
      try {
        const recentRaw = await AsyncStorage.getItem(`${RECENT_MEALS_KEY_PREFIX}_${mode}`)
        if (recentRaw) recentMealNames = JSON.parse(recentRaw)
      } catch {}

      const ok = await requestConsent()
      if (!ok) { setLoading(false); return }

      const generated = await generateMeals({
        ingredients: ingredients.length > 0 ? ingredients : ['chicken breast', 'rice', 'eggs', 'broccoli'], // GPT needs at least some ingredients to generate meaningful meals
        calorieGoal: profile?.calorie_goal || 2400,
        proteinGoal: profile?.protein_goal || 150,
        mealsPerDay: profile?.meals_per_day || 3,
        cookingSkill: profile?.cooking_skill || 'moderate',
        maxPrepMinutes: profile?.max_prep_minutes || 30,
        dietaryRestrictions: profile?.dietary_restrictions || ['None'],
        foodDislikes: profile?.food_dislikes || [],
        dislikedMeals,
        likedMeals,
        cuisinePreferences: profile?.cuisine_preferences || [],
        recentMealNames,
        mode,
        staplesExcluded: profile?.staples_excluded || [], // basics the user opted out of assuming
      })

      // Cache today's meals — include maxPrepMinutes so stale meals can be invalidated if preference changes,
      const maxPrep = profile?.max_prep_minutes || 30
      await writeMealCache(mode, { meals: generated, maxPrepMinutes: maxPrep, userId })
      perfMark(`cache WRITE post-generate (${generated.length} meals, ${todayStr()}, cap ${maxPrep})`)

      // Keep 24 names (~8 gens) rather than 12: a heavy day is 1 auto-fire + 3 rerolls = 12 names,
      // which flushed the entire old window and let yesterday's dinner come straight back.
      try {
        const newNames = generated.map(m => m.name).filter(Boolean)
        const merged = [...newNames, ...recentMealNames].slice(0, 24)
        await AsyncStorage.setItem(`${RECENT_MEALS_KEY_PREFIX}_${mode}`, JSON.stringify(merged))
      } catch {}

      // Images load progressively; errors must not block the UI. Fetched in parallel here
      // (different meal names → independent jobs); the per-image retry loop above is what's
      // serialized to avoid burst throttling.
      const mealsToImage = [...generated]
      const jobs = mealsToImage.map(async (meal, i) => {
        if (meal.image) return
        const ingNames = meal.ingredients?.map((ing: any) => ing.name) ?? []
        const image = await fetchImage(meal.name, ingNames, meal.steps ?? [])
        if (!image) return
        mealsToImage[i] = { ...mealsToImage[i], image }
        // Patched by ID, NOT by index. With the swap below now able to run late, `prev` may still
        // be YESTERDAY's meals when an image lands — an index write would paste today's photo onto
        // yesterday's dish. A no-op until the swap happens is the correct outcome; the mutation of
        // mealsToImage above is what carries the photo across.
        const id = mealsToImage[i].id
        setMeals(prev => prev.map(p => (p.id === id ? { ...p, image } : p)))
        // ...and on the OTHER screen. This setMeals belongs to one hook instance; Home and Pantry
        // each hold their own, so without this the second screen keeps whatever the `end` event
        // carried — the hero photo at best — and meals 2 and 3 shimmer forever.
        publishMealImage(generationKey(userId, mode), String(id), image)
      })

      // HOLD THE SWAP FOR THE HERO'S PHOTO — but only when something is already on screen.
      //
      // Returning image-less meals swaps a finished dish out for a shimmer, which reads as
      // something breaking rather than something loading. The photo-less card is designed for a
      // COLD start (nothing → shimmer → photo); arriving at it FROM a real photo is a downgrade
      // the user notices. Waiting for the first meal's image means the swap presents a complete
      // card instead of assembling one on screen.
      //
      // Only the FIRST image is waited for. Meals 2 and 3 land while the reader is on page 1, so
      // the reveal stays fast. On a cold start nothing is waited for at all — the skeleton is
      // already the honest state there, and delaying would only lengthen it.
      if (shownRef.current && jobs.length > 0) {
        await Promise.race([
          jobs[0],
          new Promise(resolve => setTimeout(resolve, HERO_IMAGE_WAIT_MS)),
        ])
      }

      ;(async () => {
        await Promise.all(jobs)
        await writeMealCache(mode, { meals: mealsToImage, maxPrepMinutes: maxPrep, userId })
      })()

      // mealsToImage, not `generated` — it carries whichever photos arrived during the wait.
      return mealsToImage
    } catch (err: any) {
      throw err
    }
  }

  // ONE AUTOMATIC GENERATION PER (user, mode, day).
  //
  // The effect's deps are [userId, isPremium, mode, enabled]. `enabled` flips when the pantry lands
  // and a second dep — isPremium resolving from Superwall — flipped ~23ms later, re-running it and
  // firing a SECOND generation. Logan's trace caught it twice: `generation start +2377ms` and
  // `+2400ms`, and generated_meals shows six meals sharing one timestamp where a batch is three.
  //
  // The existing `cancelled` flag does not help: it suppresses STATE UPDATES from a superseded run,
  // it does not abort an in-flight network call. Both batches completed and both were paid for.
  //
  // Worse than the money — and the reason this also closes the repeated-meals report — is that only
  // ONE batch's names reach profiles.recent_meal_names. Both generations read the old window, each
  // merges only its OWN names into it, and the later write wins. A lost update. Half of every
  // double generation is therefore invisible to the anti-repeat check and free to come back the
  // next day, which is exactly what "Egg White and Spinach Frittata" did on 09-04 -> 09-05.
  //
  // AN IN-FLIGHT LOCK, NOT A DAILY ONE. Released the moment the generation settles, either way.
  // A per-day lock was the first cut and it was wrong: Profile clears the meal cache on a diet,
  // goal or meal-frequency change SO THAT the next open regenerates, and a day-long guard would
  // silently swallow that. The bug is two calls racing 23ms apart, and an in-flight lock is exactly
  // the scope that fixes it.
  //
  // Keyed rather than a plain boolean so a day rollover or account switch is never blocked by a
  // stale lock. Manual rerolls pass forceGenerate and bypass it entirely — they are gated by
  // MEAL_GEN_CAP_PER_DAY on the server, which the client now READS rather than mirroring.

  const fetchAndGenerate = async (forceGenerate = false) => {
    if (!userId) return
    // Per CALL, not per render — this must be the key THIS invocation claimed, so the catch below
    // can only ever release a lock it actually took.
    let claimedBusKey: string | null = null
    setError(null)
    setErrorCode(null)

    try {
      // If a scan kicked off a background prefetch of these meals, wait for it to finish — it
      // writes the SAME cache we read just below, so we serve its result instead of paying to
      // generate a second time (prevents a double-spend race when cook-reveal mounts early).
      if (!forceGenerate) {
        const pre = takeCookNowPrefetch(userId, mode)
        if (pre) { setLoading(true); await pre }
      }

      // Serve cached meals instantly (no loading state)
      if (!forceGenerate) {
        const raw = await AsyncStorage.getItem(`${CACHE_KEY_PREFIX}_${mode}`)
        if (raw) {
          const cached: CachedMeals = JSON.parse(raw)
          // Cache belongs to a different account on this device — don't serve it; regenerate.
          if (cached.userId && cached.userId !== userId) {
            await AsyncStorage.removeItem(`${CACHE_KEY_PREFIX}_${mode}`)
          } else if (cached.maxPrepMinutes === undefined) {
            // Old cache format has no maxPrepMinutes — treat as miss so it regenerates with correct prep constraint
            await AsyncStorage.removeItem(`${CACHE_KEY_PREFIX}_${mode}`)
          } else if (cached.date === todayStr() && cached.meals.length > 0) {
            const validMeals = cached.meals.filter(m => !m.prepTime || Number(m.prepTime) <= cached.maxPrepMinutes!)
            const isSeeded = validMeals.every(m => m.id?.startsWith('seeded_'))
            if (validMeals.length > 0 && !isSeeded) {
              setMeals(validMeals)
              setLoading(false)
              // Fetch any missing images for cached meals
              const cachedMeals = [...cached.meals]
              if (cachedMeals.some(m => !m.image)) {
                ;(async () => {
                  await Promise.all(cachedMeals.map(async (meal, i) => {
                    if (meal.image) return
                    const ingNames = meal.ingredients?.map((ing: any) => ing.name) ?? []
                    const image = await fetchImage(meal.name, ingNames, meal.steps ?? [])
                    if (image) {
                      cachedMeals[i] = { ...cachedMeals[i], image }
                      setMeals(prev => {
                        const updated = [...prev]
                        updated[i] = { ...updated[i], image }
                        return updated
                      })
                    }
                  }))
                  await writeMealCache(mode, { meals: cachedMeals, maxPrepMinutes: cached.maxPrepMinutes!, userId })
                })()
              }
              return
            }
            // Seeded placeholders have no recipe data — clear and fall through to generate
            await AsyncStorage.removeItem(`${CACHE_KEY_PREFIX}_${mode}`)
          }
        }
      }

      // GUARD HERE, not at the top of this function. Every cache path above returns before this
      // line, so claiming the key earlier would also mark a cache-SERVING call as "generated" — and
      // then suppress the legitimate regeneration after Profile clears the cache on a diet, goal or
      // meal-frequency change. The guard belongs on the expensive call, not on the function.
      // SHARED across screens, not a ref. Home and Pantry each mount this hook and both are alive
      // in the tab navigator, so a per-instance ref could not see the other one — each would pass
      // its own guard and fire a second paid generation for the same user.
      const busKey = generationKey(userId, mode)
      if (!forceGenerate && isGenerating(busKey)) {
        perfMark('generation SUPPRESSED — one already running for this user/mode')
        return
      }
      claimedBusKey = beginGeneration(busKey) ? busKey : null
      perfMark('generation start (accepted)')
      setLoading(true)
      const generated = await generate()
      // Released as soon as this generation SETTLES, not held for the day. The bug is two calls
      // racing ~23ms apart, so an in-flight lock is enough — and a daily lock would break a
      // behaviour that is deliberate: Profile clears the cache on a diet, goal or meal-frequency
      // change precisely so the next open regenerates, and a day-long guard would swallow it.
      // Publishing the meals with the release is what makes the OTHER screen update: it holds its
      // own React state and never re-reads the cache after mount, so a regenerate on Pantry used to
      // leave Home showing the previous deck with no sign anything had happened.
      // Publish either way. A forced regeneration that ran alongside an in-flight one never
      // claimed the lock and must not release someone else's — but its meals still have to reach
      // the other screen.
      if (claimedBusKey) { endGeneration(claimedBusKey, generated ?? null); claimedBusKey = null }
      else publishGenerated(busKey, generated ?? null)
      if (generated) { setMeals(generated); setStale(false) }
    } catch (err: any) {
      // Release so a FAILED generation can be retried — holding it would leave the user with no
      // meals and no automatic second attempt. null meals means "stop waiting", not "here they are".
      if (claimedBusKey) { endGeneration(claimedBusKey, null); claimedBusKey = null }
      __DEV__ && console.log('MEAL ERROR v3:', err.message)
      __DEV__ && console.log('MEAL ERROR status:', err?.context?.status)
      // Read the response body — use clone so we don't consume it
      try {
        if (err?.context && typeof err.context.clone === 'function') {
          const bodyText = await err.context.clone().text()
          __DEV__ && console.log('MEAL ERROR body text:', bodyText)
        } else if (err?.context && typeof err.context.text === 'function') {
          const bodyText = await err.context.text()
          __DEV__ && console.log('MEAL ERROR body text:', bodyText)
        }
      } catch (readErr: any) {
        __DEV__ && console.log('MEAL ERROR body read failed:', readErr?.message)
      }
      // Check session state AFTER the error
      try {
        const s = await supabase.auth.getSession()
        __DEV__ && console.log('MEAL ERROR post-session', {
          hasSession: !!s.data?.session,
          expires_at: s.data?.session?.expires_at,
          token_preview: s.data?.session?.access_token?.slice(0, 40),
        })
      } catch {}
      setError(err.message)
      setErrorCode(err?.code ?? null)
    } finally {
      setLoading(false)
    }
  }

  // Triggers on mount, mode change, or enabled flip. Cache load is instant; daily cache
  // means the auto-fire generation happens at most once per user per day.
  // Seeded meals (onboarding placeholders) are skipped — they have no recipe data.
  // Painting cached meals needs the USER and nothing else. It used to also wait on `enabled`
  // (= pantryFetched && pantryNames.size > 0), which is a Supabase round trip — so the app sat on
  // a shimmer waiting for the network before it would read meals that were already on disk.
  //
  // GENERATION still waits for `enabled`, and must: you cannot generate pantry-aware meals without
  // the pantry, and firing early would both pick wrong meals and burn a GPT call. So the gate
  // moved down to the cache MISS branch rather than being removed.
  useEffect(() => {
    if (!userId) return
    let cancelled = false // prevents setMeals on an unmounted component if the user navigates away
    const runKey = `${userId}_${mode}_${todayStr()}`
    ;(async () => {
      // This effect now runs twice on a cold start (once before `enabled` flips, once after).
      // Without this guard the second run would re-enter the image backfill below, and a meal
      // whose photo does not exist yet would get two concurrent fetchImage calls — two cache
      // misses racing into two FAL generations for one meal. That is real money, not just noise.
      if (servedFromCacheRef.current === runKey) { setCacheChecked(true); return }
      perfMark(`cache read start (${mode})`)
      const raw = await AsyncStorage.getItem(`${CACHE_KEY_PREFIX}_${mode}`)
      // WHY a miss happened, not just THAT one did. Four different branches below discard the cache
      // and every one of them produced the same single 'cache miss' line in the trace, which is why
      // Logan's unexplained regeneration could not be pinned down from a log. Each is now named.
      if (!raw) perfMark('cache MISS: no entry stored')
      if (raw && !cancelled) {
        const cached: CachedMeals = JSON.parse(raw)
        // Cache belongs to a different account on this device — don't serve it; regenerate.
        if (cached.userId && cached.userId !== userId) {
          perfMark(`cache MISS: different user (cached ${String(cached.userId).slice(0, 8)} vs ${String(userId).slice(0, 8)})`)
          await AsyncStorage.removeItem(`${CACHE_KEY_PREFIX}_${mode}`)
        } else if (cached.maxPrepMinutes === undefined) {
          // Invalidate if no maxPrepMinutes stored (old cache format) — forces regeneration with correct prep constraint
          perfMark('cache MISS: no maxPrepMinutes (old format)')
          await AsyncStorage.removeItem(`${CACHE_KEY_PREFIX}_${mode}`)
        } else if (cached.date === todayStr() && cached.meals.length > 0) {
          // Filter out any meals that somehow slipped past the prep cap
          const validMeals = cached.meals.filter(m => !m.prepTime || Number(m.prepTime) <= cached.maxPrepMinutes!)
          const isSeeded = validMeals.every(m => m.id?.startsWith('seeded_')) // onboarding placeholder meals have no recipe data; clear them before real generation
          if (validMeals.length > 0 && !isSeeded) {
            // Real AI meals: show immediately, then fetch any missing images in background
            servedFromCacheRef.current = runKey
            // Start decoding the photos BEFORE the cards mount. Discover and Saved already do this
            // ("warm the visible cards' photos"); Home was the only screen that didn't, so its
            // images did not begin loading until expo-image asked for them at mount — roughly a
            // second of dead air with the text already on screen.
            prefetchMealImages(validMeals.map(m => m.image))
            setCacheChecked(true)
            perfMark(`meals painted from cache (${validMeals.length})`)
            setMeals(validMeals)
            setStale(false)
            if (cached.meals.some(m => !m.image)) {
              const cachedMeals = [...cached.meals]
              ;(async () => {
                await Promise.all(cachedMeals.map(async (meal, i) => {
                  if (meal.image) return
                  const ingNames = meal.ingredients?.map((ing: any) => ing.name) ?? []
                  const image = await fetchImage(meal.name, ingNames, meal.steps ?? [])
                  if (image && !cancelled) {
                    cachedMeals[i] = { ...cachedMeals[i], image }
                    setMeals(prev => {
                      const updated = [...prev]
                      updated[i] = { ...updated[i], image }
                      return updated
                    })
                  }
                }))
                await writeMealCache(mode, { meals: cachedMeals, maxPrepMinutes: cached.maxPrepMinutes!, userId })
              })()
            }
            return
          }
          // Seeded: treat as cache miss — clear and generate real meals
          perfMark(`cache MISS: ${isSeeded ? 'seeded placeholders only' : `all ${cached.meals.length} meals over prep cap ${cached.maxPrepMinutes}`}`)
          await AsyncStorage.removeItem(`${CACHE_KEY_PREFIX}_${mode}`)
        } else if (cached.meals.length > 0) {
          perfMark(`cache MISS: stale day (cached ${cached.date} vs today ${todayStr()})`)
          // A PREVIOUS day's meals, painted while today's generate underneath. They are still
          // cookable from the same pantry and still inside the 30-name anti-repeat window, so they
          // are not wrong — only not new. Showing them beats 6-8s of skeleton, and the UI labels
          // them as yesterday's, so nothing untrue is claimed. Deliberately does NOT return and
          // does NOT set servedFromCacheRef: generation continues below and replaces these.
          //
          // Discover refuses to paint a stale-day cache; this is the opposite call ON PURPOSE.
          // There, a stale paint re-lays-out the whole page under the reader. Here it is three
          // cards replaced by three cards in the same slots, and the swap is the point.
          const carry = cached.meals.filter(m => !m.prepTime || Number(m.prepTime) <= cached.maxPrepMinutes!)
          if (carry.length > 0 && !carry.every(m => m.id?.startsWith('seeded_'))) {
            prefetchMealImages(carry.map(m => m.image))
            perfMark(`carryover painted from ${cached.date} (${carry.length})`)
            setMeals(carry)
            setStale(true)
          }
        }
      }
      setCacheChecked(true)
      // Cache miss. THIS is what needs the pantry — bail until it has loaded and let the
      // `enabled` flip re-run the effect.
      if (!enabled) { perfMark('cache miss — waiting on pantry before generating'); return }
      // The mark moved INTO fetchAndGenerate's guard: logging 'generation start' here claimed a
      // generation had begun even when the guard then suppressed it, which is exactly the kind of
      // trace that sends the next reader after the wrong thing.
      if (!cancelled) { perfMark('generation requested'); fetchAndGenerate() }
    })()
    return () => { cancelled = true }
  }, [userId, isPremium, mode, enabled])

  // Manual refresh, gated by the server's own count.
  const regenerate = async () => {
    // Guarded on the SERVER's count, not a local tally. Still only advisory — the call would be
    // rejected anyway; this just avoids spending a round trip to be told so.
    if (genUsedToday !== null && genUsedToday >= MEAL_GEN_CAP_PER_DAY) return
    await fetchAndGenerate(true)
  }

  // Retry a failed gen. It DOES consume a server slot, and that is now visible rather than
  // hidden behind a local tally that never counted it — the quota is re-read when it settles.
  const retry = async () => {
    await fetchAndGenerate(true)
  }

  // Mirror so the bus callback below can read the current deck without re-subscribing on every
  // meals change (which would tear down and rebuild the subscription mid-generation).
  const mealsRef = useRef<GeneratedMeal[]>([])
  useEffect(() => { mealsRef.current = meals }, [meals])

  // Listen for a generation started by the OTHER screen. Without this, a regenerate on Pantry left
  // Home showing the previous deck with no spinner and no update — Home holds its own React state
  // and nothing re-reads the cache after mount. Both halves matter: `begin` is what makes the
  // regenerate button feel like it did something on every screen, `end` is what actually swaps the
  // meals in.
  useEffect(() => {
    if (!userId) return
    const mine = generationKey(userId, mode)
    return subscribeGeneration(e => {
      if (e.key !== mine) return
      if (e.type === 'begin') {
        setLoading(true)
        // `stale` already drives Home's sweep bar and breathing dot — the "work is happening"
        // affordance built for the carryover path. Reusing it is why a Pantry regenerate now shows
        // on Home at all, and it beats inventing a second indicator for the same fact. Only when
        // meals are on screen; with nothing to show, the skeleton is the signal.
        if (mealsRef.current.length > 0) setStale(true)
        return
      }
      if (e.type === 'image') {
        // Patched by ID, never by index — the same rule the local patch follows, because this deck
        // may still be the PREVIOUS one if the swap has not happened yet, and an index write would
        // paste today's photo onto yesterday's dish.
        setMeals(prev => prev.map(p => (String(p.id) === e.mealId ? { ...p, image: e.image } : p)))
        return
      }
      setLoading(false)
      // null means the generation failed. Leave the existing meals alone rather than blanking the
      // screen — the screen that started it owns showing the error.
      if (e.meals) { setMeals(e.meals); setStale(false); setError(null); setErrorCode(null) }
    })
  }, [userId, mode])

  // Read the SERVER's count. Cheap (one indexed row) and it is the only number that survives a
  // Profile change, an app reinstall, or a second device. Re-read whenever a generation settles —
  // including a failed one, since a cap rejection is exactly when the button must go quiet.
  const refreshQuota = useCallback(async () => {
    if (!userId) return
    try {
      const { data } = await supabase
        .from('scan_usage')
        .select('count')
        .eq('user_id', userId)
        .eq('scan_type', 'meal_gen')
        .eq('day', utcDayKey())
        .maybeSingle()
      // No row simply means nothing generated yet today; the row is created on first use.
      setGenUsedToday(Number(data?.count ?? 0))
    } catch {
      // Leave it null — unknown must not disable the button. Never surfaced to the user: the
      // authoritative answer arrives from generate-meals itself.
    }
  }, [userId])

  useEffect(() => { refreshQuota() }, [refreshQuota])
  useEffect(() => { if (!loading) refreshQuota() }, [loading, refreshQuota])

  // load() = the normal, NON-forced fetch: await a scan's in-flight prefetch (takeCookNowPrefetch)
  // or serve today's cache, and only generate on a genuine miss. cook-reveal uses this so it reuses
  // the SAME set the pantry tab serves (fixes the reveal-vs-pantry mismatch) instead of force-
  // generating a second batch — which also kills the wasted generation + the long reveal wait.
  const load = () => fetchAndGenerate(false)
  // Unknown (null) reads as allowed — see genUsedToday. The server is the gate; this only decides
  // whether the button LOOKS available, and a button that lies about being unavailable is worse
  // than one that lets you find out from an explained error.
  const canRegenerate = genUsedToday === null || genUsedToday < MEAL_GEN_CAP_PER_DAY
  return { meals, loading, stale, error, errorCode, regenerate, retry, load, cacheChecked, canRegenerate, genUsedToday, genCapPerDay: MEAL_GEN_CAP_PER_DAY }
}
