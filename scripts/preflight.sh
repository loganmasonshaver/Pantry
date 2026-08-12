#!/usr/bin/env bash
# Preflight drift check for Pantry.
#
# Backend work is invisible in the app — an edge function, a prompt tweak, a migration. You can't
# spot a missing one by looking at your phone, which is exactly how a change gets silently lost or
# silently never shipped. This reports the three places state can diverge:
#
#   1. disk vs git      — edits that were never committed (the only truly unrecoverable state)
#   2. local vs remote  — migrations written but never applied, or applied with no file
#   3. repo vs deployed — function source committed after its last deploy (Supabase deploys are
#                         NOT part of git; reverting a file does not undeploy it)
#
# Read-only. Safe to run any time, and worth running before handing the repo to another chat.

cd "$(dirname "$0")/.." || exit 1
issues=0
ok()     { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()    { printf '  \033[31m✗\033[0m %s\n' "$1"; issues=$((issues + 1)); }
review() { printf '  \033[33m?\033[0m %s\n' "$1"; }

echo ""
echo "── git ─────────────────────────────────────────"
dirty=$(git status --porcelain | wc -l | tr -d ' ')
if [ "$dirty" -gt 0 ]; then
  bad "$dirty uncommitted file(s) — this is the only state git cannot recover"
  git status --short | sed 's/^/       /'
else
  ok "working tree clean"
fi

ahead=$(git log --oneline origin/main..HEAD 2>/dev/null | wc -l | tr -d ' ')
if [ "${ahead:-0}" -gt 0 ]; then
  bad "$ahead commit(s) not pushed — safe locally, but gone if the machine dies"
else
  ok "everything pushed to origin"
fi

echo ""
echo "── migrations ──────────────────────────────────"
mig=$(npx supabase migration list 2>/dev/null | grep -E '^\s+[0-9]{14}|\|\s+[0-9]{14}')
if [ -z "$mig" ]; then
  review "could not read migration list (offline, or CLI not linked)"
else
  drift=0
  while IFS='|' read -r local remote _; do
    local=$(echo "$local" | tr -d ' ')
    remote=$(echo "$remote" | tr -d ' ')
    # A local file with no remote row has been written but never applied to the database.
    [ -n "$local" ] && [ -z "$remote" ] && { bad "migration $local written but NOT applied to remote"; drift=1; }
    # A remote row with no local file means the ledger references a migration nobody can reproduce.
    [ -z "$local" ] && [ -n "$remote" ] && { bad "migration $remote applied on remote but has NO local file"; drift=1; }
  done <<< "$mig"
  [ "$drift" -eq 0 ] && ok "local migrations match the remote ledger"
fi

echo ""
echo "── edge functions ──────────────────────────────"
deployed=$(npx supabase functions list 2>/dev/null | grep ACTIVE)
if [ -z "$deployed" ]; then
  review "could not read deployed functions (offline, or CLI not linked)"
else
  drift=0
  for dir in supabase/functions/*/; do
    name=$(basename "$dir")
    [ "$name" = "_shared" ] && continue

    # A _shared/ helper ships only when a function importing it is redeployed, so fold it into this
    # function's "last changed" time. Resolve the exact modules imported rather than the whole
    # directory — otherwise adding one new helper for one function flags all 18 as stale.
    paths=("$dir")
    while read -r sh; do
      [ -n "$sh" ] && [ -f "supabase/functions/$sh" ] && paths+=("supabase/functions/$sh")
    done < <(grep -rhoE "_shared/[a-zA-Z0-9_.-]+\.ts" "$dir" 2>/dev/null | sort -u)
    src_ts=$(git log -1 --format=%ct -- "${paths[@]}" 2>/dev/null)
    [ -z "$src_ts" ] && continue

    # The NAME column is space-padded to a fixed width, so trim before comparing.
    dep_date=$(echo "$deployed" | awk -F'|' -v n="$name" '
      { gsub(/^[ \t]+|[ \t]+$/, "", $2); gsub(/^[ \t]+|[ \t]+$/, "", $6)
        if ($2 == n) print $6 }' | head -1)
    if [ -z "$dep_date" ]; then
      bad "$name has source in git but is NOT deployed"
      drift=1
      continue
    fi
    dep_ts=$(TZ=UTC date -j -f "%Y-%m-%d %H:%M:%S" "$dep_date" +%s 2>/dev/null)
    [ -z "$dep_ts" ] && continue

    # 3-minute grace: deploying and then committing the same code is a normal order and leaves the
    # commit a few seconds "newer" than the deploy. Without this every such pair reports as drift.
    # Both rendered from epoch in local time, so the two halves are actually comparable.
    if [ "$src_ts" -gt "$((dep_ts + 180))" ]; then
      review "$name — committed $(date -r "$src_ts" '+%b %d %H:%M'), last deployed $(date -r "$dep_ts" '+%b %d %H:%M'). Redeploy if that commit touched it."
      drift=1
    fi
  done
  [ "$drift" -eq 0 ] && ok "every function deployed at or after its last source commit"
fi

echo ""
if [ "$issues" -gt 0 ]; then
  echo "  $issues blocking issue(s). ? lines are for you to eyeball — committing"
  echo "  unrelated files after a deploy trips them harmlessly."
else
  echo "  No blocking issues."
fi
echo ""
exit 0
