#!/usr/bin/env bash
# Records an Instruments "Animation Hitches" trace of Pantry on the wired iPhone, for the motion
# work in docs/PLAN-motion.md. Run it, then do the walkthrough on the phone until it stops.
#
#   bash scripts/motion-trace.sh baseline      # before a phase
#   bash scripts/motion-trace.sh phase1        # after it
#
# Measure a RELEASE build (npx expo run:ios --device --configuration Release --no-bundler). A Metro
# dev build is far slower than what ships, so its hitch numbers say nothing about lag.
# Traces land in ~/pantry-traces, outside the repo — they are hundreds of MB.
set -euo pipefail

label="${1:?usage: bash scripts/motion-trace.sh <label>}"
seconds="${2:-150}"
out_dir="$HOME/pantry-traces"
mkdir -p "$out_dir"

# The first physical iPhone in the list. Simulators are listed after their own header, so stop there.
udid="$(xcrun xctrace list devices 2>/dev/null \
  | awk '/== Simulators ==/{exit} /[Ii][Pp]hone/{print}' \
  | head -1 | sed -E 's/.*\(([0-9A-Fa-f-]+)\)[[:space:]]*$/\1/')"
if [[ -z "$udid" ]]; then
  echo "No iPhone found. Plug the phone in and unlock it." >&2
  exit 1
fi

# Disk. A 150 s recording spools ~5–6 GB of raw kernel trace into $TMPDIR before it is compressed
# into the .trace (under 1 GB), and xctrace never deletes that spool. On 2026-09-15 eighteen of them
# (31 GB) filled the disk and xctrace crashed mid-save with Trace/BPT trap. So: refuse to start
# without room, and remove this run's spool once the .trace is written (below).
min_free_gb=12
free_gb=$(df -g "$HOME" | awk 'NR==2 {print $4}')
if (( free_gb < min_free_gb )); then
  echo "Only ${free_gb} GB free; a recording needs about ${min_free_gb} GB while it saves." >&2
  echo "Leftover Instruments spools, if any: $(du -ch "${TMPDIR:-/tmp}"/instruments*.ktrace 2>/dev/null | tail -1)" >&2
  exit 1
fi
spool_marker="$(mktemp -t motion-trace-marker)"

out="$out_dir/${label}-$(date +%Y%m%d-%H%M%S).trace"
cat <<EOF

Recording ${seconds}s on the iPhone. Pantry launches fresh when recording starts.
Do this walkthrough, at a normal pace, in this order:

  1. Wait for Home to finish loading
  2. Tap every tab once, left to right, then back to Home
  3. Open a meal, scroll it, go back
  4. Open "Log food" on a meal slot, close it
  5. Log any food, then swipe that entry left and Delete it
  6. Swipe the week strip left, then right
  7. Pantry: tap an item Out, tap it back In, then scroll to the bottom
  8. Grocery: check an item, uncheck it
  9. Discover: scroll to the bottom
 10. Put the phone down until the recording stops

EOF

record_status=0
xcrun xctrace record \
  --template 'Animation Hitches' \
  --device "$udid" \
  --time-limit "${seconds}s" \
  --no-prompt \
  --output "$out" \
  --launch -- com.kobalabs.pantry || record_status=$?

# This run's spool: newer than the marker. Removed whether or not the save succeeded — a crashed
# save leaves the biggest one — but never while another recording is still running and using its own.
if ! pgrep -f "xctrace record" >/dev/null; then
  find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'instruments*.ktrace' -newer "$spool_marker" -exec rm -f {} + 2>/dev/null || true
fi
rm -f "$spool_marker"

if (( record_status != 0 )); then
  echo "xctrace exited with status ${record_status}; no usable trace. Free space now: $(df -h "$HOME" | awk 'NR==2 {print $4}')" >&2
  rm -rf "$out"
  exit "$record_status"
fi

echo
echo "Saved: $out"
node "$(dirname "$0")/motion-trace-read.mjs" "$out"
