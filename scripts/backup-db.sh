#!/bin/zsh
# Nightly database backup while the project is on Supabase's Free plan, which keeps none.
#
# Writes to ~/Backups/pantry-db on this Mac — never into the repo: the dump holds user data (emails,
# profiles, pantries). Uses the Supabase CLI's linked login, so no database password is stored here.
#
# `supabase db dump` runs pg_dump inside Docker, which this Mac does not have. `--dry-run` prints the
# exact script the CLI would run — its pg_dump flags, schema exclusions, and a temporary login that
# expires in ~5 minutes — so it is piped straight into bash and runs on Homebrew's pg_dump (libpq).
# Piped, never printed: the script carries that temporary password.
# Keeps 14 days. Restore order is roles → schema → data (Supabase's "backup and restore using the
# CLI" guide). Photos live in Storage, not the database, and are not in this backup; they regenerate.
#
# Run by the LaunchAgent com.kobalabs.pantry-db-backup (scripts/com.kobalabs.pantry-db-backup.plist).
# launchd runs a missed time on the next wake, so a Mac asleep at 04:30 backs up in the morning.
set -euo pipefail

REPO="/Users/loganshaver/pantry"
DEST="$HOME/Backups/pantry-db"
STAMP=$(date +%Y-%m-%d_%H%M)

mkdir -p "$DEST"
chmod 700 "$DEST"
cd "$REPO"

echo "[$(date '+%F %T')] backup start"
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/libpq/bin:$PATH" # launchd starts with a bare PATH
dump() { npx supabase db dump --linked --dry-run "$@" 2>/dev/null | bash; }
dump --role-only > "$DEST/$STAMP-roles.sql"
dump > "$DEST/$STAMP-schema.sql"
dump --data-only --use-copy > "$DEST/$STAMP-data.sql"
gzip -f "$DEST/$STAMP-roles.sql" "$DEST/$STAMP-schema.sql" "$DEST/$STAMP-data.sql"
chmod 600 "$DEST/$STAMP"-*.sql.gz

# A dump that came back empty is a failed backup, whatever the exit codes said.
DATA_BYTES=$(gzip -dc "$DEST/$STAMP-data.sql.gz" | wc -c | tr -d ' ')
if [ "$DATA_BYTES" -lt 100000 ]; then
  echo "[$(date '+%F %T')] backup FAILED: data dump is only $DATA_BYTES bytes"
  exit 1
fi

find "$DEST" -name '*.sql.gz' -mtime +14 -delete
echo "[$(date '+%F %T')] backup ok: $(du -sh "$DEST/$STAMP-data.sql.gz" | cut -f1) data, $DATA_BYTES bytes uncompressed"
