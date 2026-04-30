import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const replicateToken = Deno.env.get("REPLICATE_API_TOKEN")!
const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const db = createClient(supabaseUrl, supabaseServiceKey)

const INGREDIENTS = [
  // Proteins
  'chicken breast', 'chicken thigh', 'ground beef', 'ground turkey', 'salmon', 'shrimp',
  'tuna', 'tilapia', 'cod', 'pork chop', 'pork tenderloin', 'bacon', 'sausage',
  'steak', 'lamb', 'tofu', 'tempeh', 'eggs', 'turkey breast', 'canned tuna',
  'sardines', 'scallops', 'crab', 'lobster', 'duck', 'bison',
  // Dairy
  'milk', 'butter', 'cream cheese', 'cheddar cheese', 'mozzarella', 'parmesan',
  'feta cheese', 'goat cheese', 'greek yogurt', 'sour cream', 'heavy cream',
  'cottage cheese', 'ricotta', 'swiss cheese', 'cream',
  // Vegetables
  'onion', 'garlic', 'tomato', 'bell pepper', 'broccoli', 'spinach', 'kale',
  'zucchini', 'cucumber', 'carrot', 'celery', 'mushroom', 'corn', 'green beans',
  'asparagus', 'cauliflower', 'sweet potato', 'potato', 'avocado', 'lettuce',
  'cabbage', 'brussels sprouts', 'eggplant', 'jalapeno', 'green onion',
  'red onion', 'shallot', 'leek', 'artichoke', 'beet', 'radish', 'turnip',
  'squash', 'butternut squash', 'pumpkin', 'snap peas', 'edamame',
  'bok choy', 'arugula', 'watercress', 'fennel',
  // Fruits
  'banana', 'apple', 'orange', 'lemon', 'lime', 'strawberry', 'blueberry',
  'raspberry', 'mango', 'pineapple', 'peach', 'pear', 'grape', 'watermelon',
  'coconut', 'cherry', 'fig', 'pomegranate', 'kiwi', 'grapefruit', 'cranberry',
  // Grains & Starches
  'rice', 'brown rice', 'quinoa', 'pasta', 'bread', 'tortilla', 'oats',
  'couscous', 'noodles', 'flour', 'cornmeal', 'panko breadcrumbs',
  'pita bread', 'naan', 'bagel', 'croissant',
  // Legumes
  'black beans', 'chickpeas', 'lentils', 'kidney beans', 'pinto beans',
  'white beans', 'split peas', 'peanuts',
  // Nuts & Seeds
  'almonds', 'walnuts', 'cashews', 'pecans', 'pine nuts', 'pistachios',
  'sunflower seeds', 'pumpkin seeds', 'chia seeds', 'flax seeds',
  'sesame seeds', 'hemp seeds', 'macadamia nuts',
  // Oils & Fats
  'olive oil', 'coconut oil', 'sesame oil', 'vegetable oil', 'avocado oil',
  // Condiments & Sauces
  'soy sauce', 'hot sauce', 'ketchup', 'mustard', 'mayonnaise', 'vinegar',
  'balsamic vinegar', 'apple cider vinegar', 'rice vinegar', 'worcestershire sauce',
  'fish sauce', 'tahini', 'sriracha', 'bbq sauce', 'teriyaki sauce',
  'peanut butter', 'almond butter', 'honey', 'maple syrup', 'agave',
  'tomato paste', 'tomato sauce', 'salsa', 'hummus', 'guacamole',
  'ranch dressing', 'italian dressing',
  // Herbs & Spices
  'salt', 'pepper', 'paprika', 'cumin', 'chili powder', 'oregano',
  'basil', 'thyme', 'rosemary', 'cilantro', 'parsley', 'dill', 'mint',
  'ginger', 'turmeric', 'cinnamon', 'nutmeg', 'cayenne pepper',
  'garlic powder', 'onion powder', 'italian seasoning', 'bay leaf',
  'coriander', 'cardamom', 'cloves', 'star anise', 'saffron',
  'red pepper flakes', 'curry powder', 'garam masala', 'chives',
  // Baking
  'sugar', 'brown sugar', 'powdered sugar', 'baking soda', 'baking powder',
  'vanilla extract', 'cocoa powder', 'chocolate chips', 'cornstarch',
  'yeast', 'gelatin',
  // Other
  'broth', 'chicken broth', 'beef broth', 'vegetable broth', 'coconut milk',
  'almond milk', 'oat milk', 'soy milk', 'water', 'ice',
  'tortilla chips', 'crackers', 'granola', 'protein powder', 'nutritional yeast',
  'capers', 'olives', 'pickles', 'sundried tomatoes', 'roasted red peppers',
]

const SEASONINGS = new Set([
  'salt', 'pepper', 'paprika', 'cumin', 'chili powder', 'oregano', 'basil', 'thyme',
  'rosemary', 'cinnamon', 'nutmeg', 'cayenne pepper', 'garlic powder', 'onion powder',
  'italian seasoning', 'coriander', 'cardamom', 'cloves', 'star anise', 'saffron',
  'red pepper flakes', 'curry powder', 'garam masala', 'turmeric', 'dried parsley',
  'dried dill', 'bay leaf', 'allspice', 'white pepper', 'smoked paprika',
])

const SAUCES = new Set([
  'soy sauce', 'hot sauce', 'ketchup', 'mustard', 'mayonnaise', 'vinegar',
  'balsamic vinegar', 'apple cider vinegar', 'rice vinegar', 'worcestershire sauce',
  'fish sauce', 'sriracha', 'bbq sauce', 'teriyaki sauce', 'sweet chili sauce',
  'tomato sauce', 'ranch dressing', 'italian dressing', 'buffalo sauce',
])

const OILS = new Set([
  'olive oil', 'coconut oil', 'sesame oil', 'vegetable oil', 'avocado oil',
])

// Foods that should always be raw ingredient photos, never containers
const RAW_OVERRIDES = new Set([
  'bell pepper', 'red bell pepper', 'green bell pepper', 'yellow bell pepper',
  'red pepper', 'green pepper', 'jalapeno', 'habanero', 'serrano',
  'black beans', 'pinto beans', 'kidney beans', 'white beans',
  'fresh basil', 'fresh thyme', 'fresh rosemary', 'fresh oregano',
  'fresh cilantro', 'fresh parsley', 'fresh dill', 'fresh mint',
  'fresh ginger', 'ginger root',
])

const PACKAGED_MEATS = new Set([
  'ground beef', 'ground turkey', 'ground chicken', 'ground pork',
  'bacon', 'sausage', 'hot dogs', 'deli turkey', 'deli ham',
])

function isSeasoning(name: string): boolean {
  if (RAW_OVERRIDES.has(name)) return false
  if (PACKAGED_MEATS.has(name)) return false
  if (SEASONINGS.has(name)) return true
  if (/seasoning|spice|powder|dried /.test(name)) return true
  return false
}

function isPackagedMeat(name: string): boolean {
  if (PACKAGED_MEATS.has(name)) return true
  for (const m of PACKAGED_MEATS) { if (name.includes(m)) return true }
  return false
}
function isSauce(name: string): boolean {
  if (RAW_OVERRIDES.has(name)) return false
  if (SAUCES.has(name)) return true
  if (/sauce|dressing|vinaigrette/.test(name)) return true
  for (const s of SAUCES) { if (name === s || name.startsWith(s + ' ') || name.endsWith(' ' + s)) return true }
  return false
}
function isOil(name: string): boolean {
  if (OILS.has(name)) return true
  if (/\boil\b/.test(name)) return true
  return false
}

// Custom prompts for items Flux struggles with
const CUSTOM_PROMPTS: Record<string, string> = {
  'salt': 'Professional product photography of a table salt shaker, clear glass salt shaker with silver metal cap filled with white salt, on dark background, hyperrealistic, soft studio lighting, sharp focus, 8k',
  'pepper': 'Professional product photography of a wooden pepper grinder mill filled with black peppercorns, on dark background, hyperrealistic, soft studio lighting, sharp focus, 8k',
  'eggs': 'Close-up professional food photography of a single whole uncracked white egg, one egg only, minimal dark background, hyperrealistic, ultra detailed texture, soft studio lighting, sharp focus, 8k',
  'cheddar cheese': 'Close-up professional food photography of a block of sharp orange cheddar cheese, smooth texture with no holes, on dark background, hyperrealistic, soft studio lighting, sharp focus, 8k',
  'tomato': 'Professional food photography of a single whole red tomato with green stem, on dark background, hyperrealistic, soft studio lighting, sharp focus, 8k',
  'banana': 'Professional food photography of a single yellow banana, whole unpeeled, on dark background, hyperrealistic, soft studio lighting, sharp focus, 8k',
  'celery': 'Professional food photography of fresh celery stalks with leaves, full stalks visible, on dark background, hyperrealistic, soft studio lighting, sharp focus, 8k',
  'cream cheese': 'Professional product photography of a store-bought cream cheese block in foil wrapper packaging, like Philadelphia brand, on dark background, hyperrealistic, soft studio lighting, sharp focus, 8k',
  'heavy cream': 'Professional product photography of a store-bought heavy whipping cream carton, retail dairy packaging, on dark background, hyperrealistic, soft studio lighting, sharp focus, 8k',
  'mozzarella': 'Professional food photography of a single fresh mozzarella ball, smooth white and firm, on dark background, hyperrealistic, soft studio lighting, sharp focus, 8k',
  'steak': 'Professional food photography of a single raw ribeye steak with visible marbling, thick cut, on dark background, hyperrealistic, soft studio lighting, sharp focus, 8k',
  'parmesan': 'Professional food photography of a wedge of aged parmesan cheese, hard grainy texture with no holes, on dark background, hyperrealistic, soft studio lighting, sharp focus, 8k',
  'tilapia': 'Professional food photography of a pre-cut raw white tilapia fillet piece, no head no tail no bones, rectangular cut of white fish meat, on dark background, hyperrealistic, soft studio lighting, sharp focus, 8k',
  'cod': 'Professional food photography of a pre-cut raw white cod fillet piece, no head no tail no bones, rectangular cut of white fish meat, on dark background, hyperrealistic, soft studio lighting, sharp focus, 8k',
  'bread': 'Professional food photography of a loaf of sliced white sandwich bread, on dark background, hyperrealistic, soft studio lighting, sharp focus, 8k',
  'mango': 'Professional food photography of a single whole ripe mango fruit, red and yellow skin, on dark background, hyperrealistic, soft studio lighting, sharp focus, 8k',
}

function getPrompt(ingredient: string): string {
  const lower = ingredient.toLowerCase()
  if (CUSTOM_PROMPTS[lower]) return CUSTOM_PROMPTS[lower]
  if (isPackagedMeat(lower)) {
    return `Close-up professional product photography of ${ingredient} in generic grocery store packaging, clear plastic wrapped tray, filling most of the frame, minimal dark background, hyperrealistic, soft studio lighting, sharp focus, 8k`
  }
  if (isSeasoning(lower)) {
    return `Close-up professional product photography of a store-bought ${ingredient} container, retail grocery store spice aisle packaging with label, filling most of the frame, minimal dark background, hyperrealistic, soft studio lighting, sharp focus, 8k`
  }
  if (isSauce(lower)) {
    return `Close-up professional product photography of a store-bought bottle of ${ingredient}, retail grocery store packaging, filling most of the frame, minimal dark background, hyperrealistic, soft studio lighting, sharp focus, 8k`
  }
  if (isOil(lower)) {
    return `Close-up professional product photography of a store-bought bottle of ${ingredient}, retail grocery store packaging, filling most of the frame, minimal dark background, hyperrealistic, soft studio lighting, sharp focus, 8k`
  }
  return `Close-up professional food photography of raw uncooked ${ingredient}, filling most of the frame, minimal dark background, hyperrealistic, ultra detailed texture, soft studio lighting, sharp focus, 8k, editorial food magazine style`
}

async function generateImage(ingredient: string, retries = 3): Promise<string | null> {
  const prompt = getPrompt(ingredient)

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 3000))

      const res = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${replicateToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { prompt, num_outputs: 1, aspect_ratio: '1:1', output_format: 'webp', output_quality: 85 } }),
      })
      const data = await res.json()
      if (data.output?.[0]) return data.output[0]

      // Poll for completion
      const pollUrl = data.urls?.get
      if (pollUrl) {
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 500))
          const poll = await fetch(pollUrl, { headers: { 'Authorization': `Bearer ${replicateToken}` } })
          const result = await poll.json()
          if (result.output?.[0]) return result.output[0]
          if (result.status === 'failed') break
        }
      }
    } catch (e) {
      console.error(`Attempt ${attempt + 1} failed for ${ingredient}:`, e)
    }
  }
  return null
}

async function uploadToStorage(ingredient: string, imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl)
    const blob = await res.blob()
    const filename = `${ingredient.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.webp`

    const { error } = await db.storage.from('ingredient-images').upload(filename, blob, {
      contentType: 'image/webp',
      upsert: true,
    })
    if (error) { console.error(`Upload failed for ${ingredient}:`, error); return null }

    const { data } = db.storage.from('ingredient-images').getPublicUrl(filename)
    return data.publicUrl
  } catch (e) {
    console.error(`Upload error for ${ingredient}:`, e)
    return null
  }
}

Deno.serve(async (req: Request) => {
  // Manual auth check — gateway JWT verification is disabled (ES256 incompatibility)
  const user = await verifyUser(req)
  if (!user) return unauthorizedResponse()

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown'
  const { allowed } = rateLimit(ip, 5, 60000)
  if (!allowed) return rateLimitResponse()

  // Handle POST requests
  if (req.method === 'POST') {
    try {
      const body = await req.json()

      // Upload a custom image from URL to storage
      if (body.uploadUrl && body.filename) {
        const res = await fetch(body.uploadUrl)
        const blob = await res.blob()
        await db.storage.from('ingredient-images').upload(body.filename, blob, { contentType: 'image/webp', upsert: true })
        const { data } = db.storage.from('ingredient-images').getPublicUrl(body.filename)
        return new Response(JSON.stringify({ url: data.publicUrl }), { headers: { 'Content-Type': 'application/json' } })
      }

      // Clear all cached images
      if (body.clear === true) {
        await db.from('ingredient_images').delete().neq('name', '')
        // Clear storage bucket
        const { data: files } = await db.storage.from('ingredient-images').list()
        if (files && files.length > 0) {
          await db.storage.from('ingredient-images').remove(files.map(f => f.name))
        }
        return new Response(JSON.stringify({ cleared: true, count: files?.length ?? 0 }), { headers: { 'Content-Type': 'application/json' } })
      }

      if (body.single) {
        const name = body.single.toLowerCase().trim()
        // Check if already exists
        const { data: existing } = await db.from('ingredient_images').select('image_url').eq('name', name).single()
        if (existing) {
          return new Response(JSON.stringify({ url: existing.image_url }), { headers: { 'Content-Type': 'application/json' } })
        }
        // Generate
        const imageUrl = await generateImage(name)
        if (!imageUrl) {
          return new Response(JSON.stringify({ error: 'generation failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
        }
        const publicUrl = await uploadToStorage(name, imageUrl)
        if (!publicUrl) {
          return new Response(JSON.stringify({ error: 'upload failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
        }
        await db.from('ingredient_images').upsert({ name, image_url: publicUrl })
        return new Response(JSON.stringify({ url: publicUrl }), { headers: { 'Content-Type': 'application/json' } })
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
  }

  const url = new URL(req.url)
  const batchParam = url.searchParams.get('batch') ?? '0'
  const batchSize = 5
  const batchIndex = parseInt(batchParam)
  const start = batchIndex * batchSize
  const batch = INGREDIENTS.slice(start, start + batchSize)

  if (batch.length === 0) {
    return new Response(JSON.stringify({
      done: true,
      total: INGREDIENTS.length,
      message: 'All ingredients processed!'
    }), { headers: { 'Content-Type': 'application/json' } })
  }

  // Check which ones already exist
  const { data: existing } = await db.from('ingredient_images').select('name').in('name', batch)
  const existingNames = new Set(existing?.map(r => r.name) ?? [])
  const toGenerate = batch.filter(name => !existingNames.has(name))

  const results: any[] = []

  for (const ingredient of toGenerate) {
    console.log(`Generating: ${ingredient}`)
    const imageUrl = await generateImage(ingredient)
    if (!imageUrl) {
      results.push({ name: ingredient, status: 'failed' })
      continue
    }

    const publicUrl = await uploadToStorage(ingredient, imageUrl)
    if (!publicUrl) {
      results.push({ name: ingredient, status: 'upload_failed' })
      continue
    }

    await db.from('ingredient_images').upsert({ name: ingredient, image_url: publicUrl })
    results.push({ name: ingredient, status: 'ok', url: publicUrl })

    // Small delay between generations
    await new Promise(r => setTimeout(r, 500))
  }

  const skipped = batch.filter(name => existingNames.has(name))

  return new Response(JSON.stringify({
    batch: batchIndex,
    processed: results,
    skipped,
    next: start + batchSize < INGREDIENTS.length ? batchIndex + 1 : null,
    progress: `${Math.min(start + batchSize, INGREDIENTS.length)}/${INGREDIENTS.length}`,
  }, null, 2), { headers: { 'Content-Type': 'application/json' } })
})
