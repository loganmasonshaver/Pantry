#!/bin/zsh
# Nightly database backup while the project is on Supabase's Free plan, which keeps none.
#
# Writes to ~/Backups/pantry-db on this Mac — never into the repo: the dump holds user data (emails,
# profiles, pantries). Uses the Supabase CLI's linked login, so no database password is stored here.
#
# `supabase db dump` runs pg_dump inside Docker, which this Mac does not have. `--dry-run` prints the
# exact script the CLI would run — its pg_dump flags, schema exclusions, and a temporary login that
# expires in ~5 minutes — so it is piped straight into bash and runs on Homebrew's pg_dump (libpq).
# Piped, never printed: the script carries that temporary password. The CLI's stderr carries only
# status lines, so it is kept aside and logged when a step fails.
# Keeps 14 days. Restore order is roles → schema → data (Supabase's "backup and restore using the
# CLI" guide). Photos live in Storage, not the database, and are not in this backup; they regenerate.
#
# Run by the LaunchAgent com.kobalabs.pantry-db-backup (scripts/com.kobalabs.pantry-db-backup.plist)
# every hour at :30. The first scheduled run, 04:30 on 2026-09-17, fired while the Mac was in a
# maintenance dark wake and failed with nothing in the log (stderr was discarded, errexit quit
# silently). So a run is skipped once today has a good backup or before 04:30 (the day's trending
# crons finish ~03:20 local), and anything else retries an hour later until one succeeds.
# FORCE=1 skips both checks, for a manual run.
set -euo pipefail

REPO="/Users/loganshaver/pantry"
DEST="$HOME/Backups/pantry-db"
STAMP=$(date +%Y-%m-%d_%H%M)
CLI_ERR="$DEST/.cli-stderr"

mkdir -p "$DEST"
chmod 700 "$DEST"
cd "$REPO"

if [ -z "${FORCE:-}" ]; then
  done_today=( "$DEST/$(date +%Y-%m-%d)"_*-data.sql.gz(N) )
  (( ${#done_today} > 0 )) && exit 0
  (( 10#$(date +%H%M) < 430 )) && exit 0
fi

# errexit inside a function exits zsh without running an EXIT trap, so each step checks itself.
# Removing this run's files matters: a leftover .gz would count as today's backup and stop the retry.
# SECRET_LINES drops any line that could carry a database password, before it is written or logged.
SECRET_LINES='pgpassword|password=|://[^/@ ]+:[^/@ ]+@'
fail() {
  echo "[$(date '+%F %T')] backup FAILED: $1"
  grep -viE "$SECRET_LINES" "$CLI_ERR" 2>/dev/null | tail -n 15 | sed 's/^/  cli: /' || true
  rm -f "$DEST/$STAMP"-*.sql(N) "$DEST/$STAMP"-*.sql.gz(N) "$CLI_ERR"
  exit 1
}

echo "[$(date '+%F %T')] backup start"
: > "$CLI_ERR"
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/libpq/bin:$PATH" # launchd starts with a bare PATH
# The script is captured before bash sees it: a failing CLI prints its error as JSON on stdout, and
# piped straight in, bash ran that error as a command and the message was lost.
dump() {
  local script rc=0
  script=$(npx supabase db dump --linked --dry-run "$@" 2>>"$CLI_ERR") || rc=$?
  if (( rc != 0 )) || [[ $script != '#!/usr/bin/env bash'* ]]; then
    print -r -- "$script" | grep -viE "$SECRET_LINES" | head -n 15 >> "$CLI_ERR"
    return $(( rc ? rc : 90 ))
  fi
  print -r -- "$script" | bash
}
dump --role-only > "$DEST/$STAMP-roles.sql" || fail "roles dump (exit $?)"
dump > "$DEST/$STAMP-schema.sql" || fail "schema dump (exit $?)"
dump --data-only --use-copy > "$DEST/$STAMP-data.sql" || fail "data dump (exit $?)"
gzip -f "$DEST/$STAMP-roles.sql" "$DEST/$STAMP-schema.sql" "$DEST/$STAMP-data.sql" || fail "gzip (exit $?)"
chmod 600 "$DEST/$STAMP"-*.sql.gz

# A dump that came back empty is a failed backup, whatever the exit codes said.
DATA_BYTES=$(gzip -dc "$DEST/$STAMP-data.sql.gz" | wc -c | tr -d ' ')
[ "$DATA_BYTES" -lt 100000 ] && fail "data dump is only $DATA_BYTES bytes"

rm -f "$CLI_ERR"
find "$DEST" -name '*.sql.gz' -mtime +14 -delete
echo "[$(date '+%F %T')] backup ok: $(du -sh "$DEST/$STAMP-data.sql.gz" | cut -f1) data, $DATA_BYTES bytes uncompressed"
