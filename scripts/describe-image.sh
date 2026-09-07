#!/usr/bin/env bash
# Ask generate-meal-image what it WOULD draw, without drawing it.
#
# Stage 1 (the LLM that writes the visual description) is otherwise only console.logged during a
# real generation, which makes "is the description wrong, or is Flux ignoring a correct one?"
# unanswerable after the fact. describeOnly answers it for free: no FAL credits, no cache write,
# no image. It is internal-auth only precisely because it is an unmetered LLM call.
#
# Usage:
#   export CRON_SECRET=...              # Supabase → Vault, or the value you set as the function secret
#   bash scripts/describe-image.sh recipe.json            # description only, free
#   bash scripts/describe-image.sh recipe.json --render    # actually render it (~$0.003)
#   bash scripts/describe-image.sh recipe.json --render 7  # ...with a fixed seed, for an A/B
#
# recipe.json is the meal as the client would send it:
#   { "mealName": "...", "ingredients": ["..."], "steps": [{"title":"...","detail":"..."}] }
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-fdafjnkqqtpsjtddbfdz}"
RECIPE="${1:-}"
MODE="${2:-}"
SEED="${3:-}"

if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET is not set. Read it from Supabase → Vault, then: export CRON_SECRET=..." >&2
  exit 1
fi
if [ -z "$RECIPE" ] || [ ! -f "$RECIPE" ]; then
  echo "usage: bash scripts/describe-image.sh <recipe.json>" >&2
  exit 1
fi

# --render turns this into a REAL generation. bypassCache goes with it, because a dish that already
# has an image would otherwise return the broken one forever — the cache check is unconditional by
# design so a client cannot force paid regeneration.
BODY=$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
if sys.argv[2] == '--render':
    d['bypassCache'] = True
    d['replaceTrending'] = True   # overwrite the trending row too, not just the cache
    if sys.argv[3]: d['seed'] = int(sys.argv[3])
else:
    d['describeOnly'] = True
print(json.dumps(d))
" "$RECIPE" "$MODE" "$SEED")

if [ "$MODE" = "--render" ]; then
  echo "rendering for real (~\$0.003, overwrites the cached image)..." >&2
fi

curl -sS -X POST "https://${PROJECT_REF}.supabase.co/functions/v1/generate-meal-image" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  -d "$BODY" | python3 -m json.tool
