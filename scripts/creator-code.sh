#!/usr/bin/env bash
# Mint a referral code. Values are generated here and land ONLY in the database —
# never commit a code. A committed premium code is exactly the bug that
# 20260904151500/152600 exists to fix; see docs/PRELAUNCH.md 6e.
#
#   ./scripts/creator-code.sh comp     "Sarah Chen"      # free premium, 1 use, 180d
#   ./scripts/creator-code.sh audience "Sarah Chen"      # attribution only, unlimited
#
# comp     -> grants_premium=true,  max_redemptions=1.  Send PRIVATELY to the creator.
# audience -> grants_premium=false, unlimited.          Safe to say out loud in a video.
set -euo pipefail

KIND="${1:-}"; NAME="${2:-}"
[ -z "$KIND" ] || [ -z "$NAME" ] && { echo "usage: $0 <comp|audience> \"Creator Name\""; exit 1; }

case "$KIND" in
  # 1 use so a leaked comp code is spent, not shared. Suffix keeps it unguessable:
  # the name half is public (it is in the video), the random half is the secret.
  comp)     PREMIUM=true;  CAP=1;    EXPIRY="now() + interval '180 days'"; SUFFIX=true ;;
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
