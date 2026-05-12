import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const adminSecret = Deno.env.get("ADMIN_SECRET")!
const db = createClient(supabaseUrl, supabaseServiceKey)

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return new Response('Invalid JSON', { status: 400 })

  // Verify admin password
  if (body.secret !== adminSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const { action } = body

  // ── Add or update a creator ──
  if (action === 'upsert_creator') {
    const { name, handle, avatar_url, bio, youtube_url, instagram_url, tiktok_url, affiliate_code } = body
    if (!name || !handle) {
      return new Response(JSON.stringify({ error: 'name and handle are required' }), { status: 400 })
    }
    const { data, error } = await db
      .from('creators')
      .upsert({ name, handle, avatar_url, bio, youtube_url, instagram_url, tiktok_url, affiliate_code, is_active: true }, { onConflict: 'handle' })
      .select()
      .single()
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    return new Response(JSON.stringify({ creator: data }), { status: 200 })
  }

  // ── Add a recipe to trending_meals linked to a creator ──
  if (action === 'add_creator_recipe') {
    const { creator_handle, name, calories, protein, carbs, fat, prep_time, ingredients, steps, image } = body
    if (!creator_handle || !name) {
      return new Response(JSON.stringify({ error: 'creator_handle and name are required' }), { status: 400 })
    }
    // Look up creator id by handle
    const { data: creator, error: creatorErr } = await db
      .from('creators')
      .select('id')
      .eq('handle', creator_handle)
      .single()
    if (creatorErr || !creator) {
      return new Response(JSON.stringify({ error: `Creator @${creator_handle} not found` }), { status: 404 })
    }
    const { data, error } = await db
      .from('trending_meals')
      .insert({
        name,
        calories: calories ?? 0,
        protein: protein ?? 0,
        carbs: carbs ?? 0,
        fat: fat ?? 0,
        prep_time: prep_time ?? 0,
        ingredients: ingredients ?? [],
        steps: steps ?? [],
        image: image ?? null,
        trend_source: 'creator',
        creator_id: creator.id,
        generated_at: new Date().toISOString().split('T')[0],
      })
      .select()
      .single()
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    return new Response(JSON.stringify({ recipe: data }), { status: 200 })
  }

  // ── List all creators ──
  if (action === 'list_creators') {
    const { data, error } = await db.from('creators').select('*').order('created_at', { ascending: false })
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    return new Response(JSON.stringify({ creators: data }), { status: 200 })
  }

  return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 })
})
