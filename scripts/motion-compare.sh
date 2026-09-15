#!/usr/bin/env bash
# One sitting for a motion phase (docs/PLAN-motion.md §3): trace the build already on the phone,
# build + install the current code as Release, trace again, compare, then put the dev build back.
#
#   bash scripts/motion-compare.sh baseline phase1
#
# Expects the BEFORE code to already be installed as a Release build. About 30 minutes, most of it
# the build; you are needed for two ~2.5 minute walkthroughs and it waits for Enter before each.
set -euo pipefail
cd "$(dirname "$0")/.."

before="${1:?usage: bash scripts/motion-compare.sh <before-label> <after-label>}"
after="${2:?usage: bash scripts/motion-compare.sh <before-label> <after-label>}"
logdir="$HOME/pantry-traces"
mkdir -p "$logdir"

udid="$(xcrun xctrace list devices 2>/dev/null \
  | awk '/== Simulators ==/{exit} /[Ii][Pp]hone/{print}' \
  | head -1 | sed -E 's/.*\(([0-9A-Fa-f-]+)\)[[:space:]]*$/\1/')"
[[ -n "$udid" ]] || { echo "No iPhone found. Plug the phone in and unlock it." >&2; exit 1; }

read -r -p $'\nWalkthrough 1 of 2 ('"$before"$'). Phone unlocked and in hand? Press Enter to start. '
bash scripts/motion-trace.sh "$before" | tee "$logdir/$before-summary.txt"

echo
echo "Building the current code as Release and installing it. This takes a while; the phone can sit."
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 CI=1 \
  npx expo run:ios --device "$udid" --configuration Release --no-bundler > "$logdir/$after-build.log" 2>&1 \
  || { echo "Release build failed — see $logdir/$after-build.log" >&2; exit 1; }
echo "Installed."

read -r -p $'\nWalkthrough 2 of 2 ('"$after"$'), same steps. Press Enter to start. '
bash scripts/motion-trace.sh "$after" | tee "$logdir/$after-summary.txt"

echo
echo "================ BEFORE vs AFTER ================"
grep -E "HITCH TIME RATIO|hitches  |worst" "$logdir/$before-summary.txt" | sed "s/^/  $before: /"
grep -E "HITCH TIME RATIO|hitches  |worst" "$logdir/$after-summary.txt"  | sed "s/^/  $after:  /"
echo "Summaries: $logdir/$before-summary.txt, $logdir/$after-summary.txt"

read -r -p $'\nReinstall your normal dev build (Metro on 8081) now? [Y/n] ' again
if [[ ! "$again" =~ ^[Nn] ]]; then
  LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 CI=1 \
    npx expo run:ios --device "$udid" --no-bundler > "$logdir/dev-build.log" 2>&1 \
    && echo "Dev build installed." \
    || echo "Dev build failed — see $logdir/dev-build.log"
fi
echo "Done. Tell Claude: \"motion compare done\"."
