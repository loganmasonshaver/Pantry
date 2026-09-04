#!/usr/bin/env bash
# Mint a referral code. Values are generated here and land ONLY in the database —
# never commit a code. A committed premium code is exactly the bug that
# 20260904151500/152600 exists to fix; see docs/PRELAUNCH.md 6e.
#
#   ./scripts/creator-code.sh comp     "Sarah Chen"       # free premium, 1 use, 180d
#   ./scripts/creator-code.sh comp     "Creators"    25   # ONE shared code, capped at 25
#   ./scripts/creator-code.sh audience "Sarah Chen"       # attribution only, unlimited
#
# comp     -> grants_premium=true, capped.   Send PRIVATELY. Never said on camera.
# audience -> grants_premium=false, unlimited. Safe to say out loud in a video.
#
# THE CAP IS THE SAFETY, NOT THE ROTATION. Deactivating a leaked code does not revoke
# anyone: redeem_referral_code writes promo_active onto the profile, and that column
# survives the code being switched off (verified when PANTRY_CREATOR! was disabled and
# all three comped accounts kept access). So a leak costs you everything redeemed before
# you noticed. A cap bounds that to a number you chose and turns redemption_count into
# the signal that it happened. Uncapped — which is what PANTRY_CREATOR! was — the loss is
# unbounded and silent.
#
# One shared comp code is fine BECAUSE of the cap. Audience codes stay per-creator for a
# different reason entirely: profiles.referral_code_used is the only record of who drove
# a signup, and Stage 1 of the creator program pays 50% of first conversions. A shared
# audience code makes that unpayable.
set -euo pipefail

KIND="${1:-}"; NAME="${2:-}"; CAP_ARG="${3:-}"
[ -z "$KIND" ] || [ -z "$NAME" ] && { echo "usage: $0 <comp|audience> \"Creator Name\" [cap]"; exit 1; }
case "$CAP_ARG" in ''|*[!0-9]*) [ -n "$CAP_ARG" ] && { echo "cap must be a positive integer"; exit 1; } ;; esac

case "$KIND" in
  # 1 use so a leaked comp code is spent, not shared. Suffix keeps it unguessable:
  # the name half is public (it is in the video), the random half is the secret.
  # Default 1 use = a personal code for one creator. Pass a cap to make it a SHARED code
  # for several. Either way it is capped: an uncapped premium code is the original bug.
  comp)     PREMIUM=true;  CAP="${CAP_ARG:-1}"; EXPIRY="now() + interval '180 days'"; SUFFIX=true ;;
  # No cap and no expiry — this one is meant to spread, it just cannot grant anything.
  audience) PREMIUM=false; CAP=NULL; EXPIRY=NULL;                          SUFFIX=false ;;
  *) echo "first arg must be 'comp' or 'audience'"; exit 1 ;;
esac

# Strip to A-Z0-9, cap at 10 chars, so the code stays typable on a phone keyboard.
SLUG=$(echo "$NAME" | tr '[:lower:]' '[:upper:]' | tr -cd '[:alnum:]' | cut -c1-10)
[ -z "$SLUG" ] && { echo "creator name has no alphanumeric characters"; exit 1; }

if [ "$SUFFIX" = true ]; then
  CODE_EXPR="'${SLUG}-'||upper(substr(md5(gen_random_uuid()::text),1,5))"
else
  CODE_EXPR="'${SLUG}'"
fi

# Single-quote escaping, NOT dollar-quoting: bash expands $$ to its own PID inside a
# non-quoted heredoc, which produced "trailing junk after numeric literal" on the first run.
NAME_ESC=${NAME//\'/\'\'}

TMP=$(mktemp /tmp/creator-code.XXXXXX.sql)
trap 'rm -f "$TMP"' EXIT
cat > "$TMP" <<SQL
insert into referral_codes (code, creator_name, active, grants_premium, notes, max_redemptions, expires_at)
values (${CODE_EXPR}, '${NAME_ESC}', true, ${PREMIUM}, '${KIND} code', ${CAP}, ${EXPIRY})
on conflict (code) do nothing
returning code, grants_premium, max_redemptions, expires_at;
SQL

echo "Minting ${KIND} code for ${NAME}…"
npx supabase db query --linked --file "$TMP"
