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
#   4. shoot-mode secrets — abuse ceilings temporarily raised for filming and never put back
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
# CLI 2.116 emits JSON here by DEFAULT, and (counter-intuitively) `-o json` gives back the old
# padded table — so neither flag choice is safe to assume. Normalise both shapes to
# "local<TAB>remote" and let the same comparison run. A preamble ("Initialising login role...")
# precedes the payload, so the JSON is located rather than assumed to start at byte 0.
mig=$(npx supabase migration list 2>/dev/null | python3 -c "
import sys, json, re
raw = sys.stdin.read()
i = raw.find('{')
if i != -1:
    try:
        d = json.loads(raw[i:])
        for r in d.get('migrations', []):
            print(f\"{r.get('local','') or ''}\t{r.get('remote','') or ''}\")
        sys.exit(0)
    except Exception:
        pass
# Table fallback: rows look like ' \`2026...\` | \`2026...\` | \`time\` ', either side possibly blank.
for line in raw.splitlines():
    if '|' not in line or '---' in line: continue
    cols = [re.sub(r'[^0-9]', '', c) for c in line.split('|')[:2]]
    if len(cols) == 2 and (cols[0] or cols[1]) and (len(cols[0]) in (0, 14)) and (len(cols[1]) in (0, 14)):
        print(f'{cols[0]}\t{cols[1]}')
" 2>/dev/null)
if [ -z "$mig" ]; then
  review "could not read migration list (offline, or CLI not linked)"
else
  drift=0
  while IFS=$'\t' read -r local remote; do
    # A local file with no remote row has been written but never applied to the database.
    [ -n "$local" ] && [ -z "$remote" ] && { bad "migration $local written but NOT applied to remote"; drift=1; }
    # A remote row with no local file means the ledger references a migration nobody can reproduce.
    [ -z "$local" ] && [ -n "$remote" ] && { bad "migration $remote applied on remote but has NO local file"; drift=1; }
  done <<< "$mig"
  [ "$drift" -eq 0 ] && ok "local migrations match the remote ledger"
fi

echo ""
echo "── edge functions ──────────────────────────────"
# CLI 2.116 changed `functions list` from a padded table to JSON. The old parser split on '|' and
# read fixed columns, so after the upgrade every function silently reported "NOT deployed" — 19
# false blockers at once, which is worse than no check because it trains you to ignore the output.
# Parse the JSON instead: it carries updated_at as epoch MILLIS, which needs no date parsing at all.
# `-o json` is explicit so a future default flip back to a table can't quietly break this again.
deployed=$(npx supabase functions list -o json 2>/dev/null)
if [ -z "$deployed" ] || ! printf '%s' "$deployed" | grep -q '"slug"'; then
  review "could not read deployed functions (offline, or CLI not linked)"
else
  # slug<TAB>updated_at_seconds, one ACTIVE function per line.
  deployed=$(printf '%s' "$deployed" | python3 -c "
import sys, json
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
rows = d.get('functions', d) if isinstance(d, dict) else d
for r in rows if isinstance(rows, list) else []:
    if r.get('status') == 'ACTIVE' and r.get('slug'):
        print(f\"{r['slug']}\t{int(r.get('updated_at', 0)) // 1000}\")
" 2>/dev/null)
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

    dep_ts=$(printf '%s' "$deployed" | awk -F'\t' -v n="$name" '$1 == n { print $2 }' | head -1)
    if [ -z "$dep_ts" ] || [ "$dep_ts" = "0" ]; then
      bad "$name has source in git but is NOT deployed"
      drift=1
      continue
    fi

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
echo "── shoot-mode secrets ──────────────────────────"
# SCAN_CAP_WEEK gets raised to film the trailer (7 real scans will not survive a shoot) and has to
# go back afterwards. The code comment in scan-pantry calls this "the forgot-to-revert-before-launch
# footgun" — a raised cap left in prod removes the cost ceiling on the most expensive endpoint in
# the app. A note in a todo file is not a guard, so check it here where it blocks.
#
# Supabase stores an unsalted SHA-256 of each secret value, so the digest alone confirms a
# short known value without ever reading it. 7 is the prod default; the secret being ABSENT is
# also correct, since scan-pantry falls back to 7.
secrets=$(npx supabase secrets list -o json 2>/dev/null)
if [ -z "$secrets" ]; then
  review "could not read secrets (offline, or CLI not linked)"
else
  cap_digest=$(printf '%s' "$secrets" | python3 -c "
import sys, json
try: rows = json.load(sys.stdin)
except Exception: sys.exit(0)
rows = rows.get('secrets', rows) if isinstance(rows, dict) else rows
for r in rows if isinstance(rows, list) else []:
    if r.get('name') == 'SCAN_CAP_WEEK': print(r.get('value','')); break
" 2>/dev/null)
  seven=$(printf '%s' '7' | shasum -a 256 | cut -d' ' -f1)
  if [ -z "$cap_digest" ]; then
    ok "SCAN_CAP_WEEK unset — scan-pantry falls back to 7/week"
  elif [ "$cap_digest" = "$seven" ]; then
    ok "SCAN_CAP_WEEK is 7 (prod value)"
  else
    bad "SCAN_CAP_WEEK is RAISED — shoot mode is still on. Revert before launch:"
    printf '       npx supabase secrets unset SCAN_CAP_WEEK\n'
  fi
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
