#!/bin/bash
set -euo pipefail
animo_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
animo_app="$animo_dir/Animo.app"
if [[ ! -d "$animo_app" ]]; then
  echo "Animo.app must be in the same folder as this command."
  exit 1
fi
# Local development signature; Developer ID signing and notarization are separate.
/usr/bin/codesign --force --deep --sign - "$animo_app"
/usr/bin/open "$animo_app"
