#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
if ! "$HOME/.maestro/bin/maestro" test --test-output-dir=build/ui .maestro/smoke.yaml; then
  adb exec-out screencap -p > build/ChatFinity-failure.png
  adb logcat -d -t 500 > build/ChatFinity-runtime.log
  exit 1
fi
