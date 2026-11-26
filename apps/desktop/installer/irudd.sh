#!/bin/bash
set -euo pipefail
launcher="$0"
while [[ -L "$launcher" ]]; do
  parent="$(dirname "$launcher")"
  launcher="$(readlink "$launcher")"
  [[ "$launcher" == /* ]] || launcher="$parent/$launcher"
done
runtime="$(cd "$(dirname "$launcher")" && pwd -P)"
entry=irudd
case "${1:-}" in
  host) entry=irudd-host; shift ;;
  mcp) entry=irudd-mcp; shift ;;
esac
export ELECTRON_RUN_AS_NODE=1 IRUDD_AGENT_COMMAND="$0"
exec "$runtime/Electron" --no-warnings=ExperimentalWarning "$runtime/../Resources/app/dist/clients/$entry.mjs" "$@"
