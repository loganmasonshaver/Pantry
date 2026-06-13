// One-off: generate the do/don't shelf photos for the pantry-scan prep screen via FAL Flux 2.
// Mirrors the production pipeline in supabase/functions/generate-meal-image (same endpoint,
// auth header, body). Sequential with 3 retries / 3s gaps — never parallel (FAL rate-limits
// and parallel bursts fail more often than they save time).
//
// Run from repo root with the key in your shell (never paste it into chat):
//   FAL_API_KEY=xxxx node scripts/gen-scan-prep-images.mjs

import { writeFile, mkdir } from 'node:fs/promises'

const FAL_API_KEY = process.env.FAL_API_KEY
if (!FAL_API_KEY) {
  console.error('Missing FAL_API_KEY. Run: FAL_API_KEY=xxxx node scripts/gen-scan-prep-images.mjs')
  process.exit(1)
}

// Shared photographic framing so both images read as the SAME real iPhone snapshot of a
// home pantry shelf — not glossy stock. The only difference that should jump out is the
// density/visibility of the items, since that's the lesson the do/don't pair teaches.
const COMMON = 'realistic amateur iPhone photo of a home kitchen pantry shelf, natural indoor lighting, eye-level, everyday grocery items (cans, jars, boxes, bottles, bags), no people, no text overlays, candid and unstyled, slightly imperfect like a real phone snapshot'

const IMAGES = [
  {
    name: 'dont.jpg',
    // The failure mode this whole feature fights: items stacked deep so the back rows are
    // invisible to the camera = silently missed in the scan.
    prompt: `${COMMON}, but OVERSTUFFED and cluttered: items packed two to three deep, jars and cans hidden behind other items, products turned at random angles with labels facing away, deep shadows, hard to tell what is back there`,
  },
  {
    name: 'do.jpg',
    prompt: `${COMMON}, but TIDY and well organized: every item pulled forward into a single front row, one layer deep, labels facing the camera, nothing hidden behind anything, each product clearly visible and readable. Bright, airy, well-lit with soft even daylight, clean and inviting, slightly brighter than average`,
  },
]

// Optional filter: `node scripts/gen-scan-prep-images.mjs do` regenerates only do.jpg,
// leaving the other image untouched. Exact basename match — `startsWith` would wrongly
// catch dont.jpg when asked for "do". No arg = generate all.
const only = process.argv[2]
const targets = only ? IMAGES.filter(i => i.name === `${only}.jpg`) : IMAGES

async function generateOne({ name, prompt }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://fal.run/fal-ai/flux-2', {
        method: 'POST',
        headers: { Authorization: `Key ${FAL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, image_size: 'portrait_4_3', num_images: 1, output_format: 'jpeg' }),
      })
      const data = await res.json()
      const url = data.images?.[0]?.url
      if (!url) {
        console.log(`[${name}] attempt ${attempt + 1}: no image url`, JSON.stringify(data).slice(0, 200))
        await new Promise(r => setTimeout(r, 3000))
        continue
      }
      const blob = await (await fetch(url)).arrayBuffer()
      await writeFile(`assets/scan-prep/${name}`, Buffer.from(blob))
      console.log(`[${name}] ✓ saved (${Math.round(blob.byteLength / 1024)} KB)`)
      return true
    } catch (e) {
      console.log(`[${name}] attempt ${attempt + 1} threw:`, e.message)
      await new Promise(r => setTimeout(r, 3000))
    }
  }
  console.error(`[${name}] ✗ failed after 3 attempts`)
  return false
}

await mkdir('assets/scan-prep', { recursive: true })
for (const img of targets) await generateOne(img) // sequential on purpose
console.log('Done.')
