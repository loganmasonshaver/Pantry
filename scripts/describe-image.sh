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
#   bash scripts/describe-image.sh recipe.json
#
# recipe.json is the meal as the client would send it:
#   { "mealName": "...", "ingredients": ["..."], "steps": [{"title":"...","detail":"..."}] }
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-fdafjnkqqtpsjtddbfdz}"
RECIPE="${1:-}"

if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET is not set. Read it from Supabase → Vault, then: export CRON_SECRET=..." >&2
  exit 1
fi
if [ -z "$RECIPE" ] || [ ! -f "$RECIPE" ]; then
  echo "usage: bash scripts/describe-image.sh <recipe.json>" >&2
  exit 1
fi

# describeOnly is added here rather than being required in the file, so the same recipe JSON can be
# reused for a real generation by dropping this script.
BODY=$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
d['describeOnly'] = True
print(json.dumps(d))
" "$RECIPE")

curl -sS -X POST "https://${PROJECT_REF}.supabase.co/functions/v1/generate-meal-image" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  -d "$BODY" | python3 -m json.tool
