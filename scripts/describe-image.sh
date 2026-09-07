#!/usr/bin/env bash
# Ask generate-meal-image what it WOULD draw, render it for real, or A/B the prompt-adherence knob.
#
# Stage 1 (the LLM that writes the visual description) is otherwise only console.logged during a
# real generation, which makes "is the description wrong, or is Flux ignoring a correct one?"
# unanswerable after the fact. describeOnly answers it for free: no FAL credits, no cache write,
# no image. Internal-auth only, because it is an unmetered LLM call.
#
#   export CRON_SECRET=...                                  # Apple Passwords: "Pantry — Supabase CRON_SECRET"
#   bash scripts/describe-image.sh recipe.json              # description only, free
#   bash scripts/describe-image.sh recipe.json --render     # render it (~$0.003, overwrites the cached image)
#   SEED=7 GUIDANCE=5 bash scripts/describe-image.sh recipe.json --render
#   bash scripts/describe-image.sh recipe.json --ab         # guidance sweep at one fixed seed
#
# --ab is the reason the seed override exists: without pinning the seed you are comparing two
# different pictures, not two guidance values. Each render is downloaded to image-ab/ as it goes,
# because all of them upsert to the SAME storage path and would otherwise overwrite each other.
#
# recipe.json is the meal as the client would send it:
#   { "mealName": "...", "ingredients": ["..."], "steps": [{"title":"...","detail":"..."}] }
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-fdafjnkqqtpsjtddbfdz}"
RECIPE="${1:-}"
MODE="${2:-}"
: "${SEED:=}"
: "${GUIDANCE:=}"
: "${EXPANSION:=}"
AB_VALUES="${AB_VALUES:-3.5 5 7}"
AB_SEED="${AB_SEED:-424242}"
OUT_DIR="${OUT_DIR:-image-ab}"

if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET is not set. export it from Apple Passwords first." >&2
  exit 1
fi
if [ -z "$RECIPE" ] || [ ! -f "$RECIPE" ]; then
  echo "usage: bash scripts/describe-image.sh <recipe.json> [--render|--ab]" >&2
  exit 1
fi

call() { # $1=mode  $2=seed  $3=guidance
  local body
  body=$(MODE="$1" SEED="$2" GUIDANCE="$3" EXPANSION="$EXPANSION" python3 -c "
import json, os, sys
d = json.load(open(sys.argv[1]))
if os.environ['MODE'] == 'render':
    d['bypassCache'] = True        # a dish that already has an image returns the broken one forever otherwise
    d['replaceTrending'] = True    # anything worth re-rendering is worth fixing on the Discover row
    if os.environ['SEED']:      d['seed'] = int(os.environ['SEED'])
    if os.environ['GUIDANCE']:  d['guidanceScale'] = float(os.environ['GUIDANCE'])
    if os.environ['EXPANSION']: d['promptExpansion'] = os.environ['EXPANSION'] == 'true'
else:
    d['describeOnly'] = True
print(json.dumps(d))
" "$RECIPE")
  curl -sS -X POST "https://${PROJECT_REF}.supabase.co/functions/v1/generate-meal-image" \
    -H "Authorization: Bearer ${CRON_SECRET}" -H "Content-Type: application/json" -d "$body"
}

case "$MODE" in
  --ab)
    mkdir -p "$OUT_DIR"
    echo "guidance sweep at seed ${AB_SEED} — $(echo "$AB_VALUES" | wc -w | tr -d ' ') renders, ~\$0.003 each" >&2
    for g in $AB_VALUES; do
      echo "  guidance=${g} ..." >&2
      url=$(call render "$AB_SEED" "$g" | python3 -c "import json,sys; print(json.load(sys.stdin).get('image') or '')")
      if [ -z "$url" ]; then echo "    FAILED (no image url)" >&2; continue; fi
      # Cache-bust. Every render upserts to the SAME storage path and the objects are served with
      # a 1-year cacheControl, so without this the CDN hands back the previous guidance value's
      # image and the whole sweep looks identical.
      case "$url" in *\?*) sep='&' ;; *) sep='?' ;; esac
      curl -sS "${url}${sep}x=$(date +%s)-${g}" -o "${OUT_DIR}/g${g}.jpg"
      echo "    -> ${OUT_DIR}/g${g}.jpg" >&2
    done
    echo "done. compare the files in ${OUT_DIR}/" >&2
    ;;
  --render)
    echo "rendering for real (~\$0.003, overwrites the cached image)..." >&2
    call render "$SEED" "$GUIDANCE" | python3 -m json.tool
    ;;
  *)
    call describe "" "" | python3 -m json.tool
    ;;
esac
