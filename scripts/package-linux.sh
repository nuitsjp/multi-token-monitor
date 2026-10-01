#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $(uname -m) == x86_64 ]] || { echo 'Linux x64 is required' >&2; exit 1; }
[[ -f dist/server/MultiTokenMonitor.dll && -f dist/server/wwwroot/index.html ]]
mkdir -p dist/package
cp LICENSE dist/server/LICENSE
python3 - <<'PY'
import json, pathlib, subprocess
root = pathlib.Path('.')
manifest = {
    'version': 'v' + json.loads((root / 'package.json').read_text())['version'],
    'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
    'platform': 'linux-x64',
}
(root / 'dist/server/release.json').write_text(json.dumps(manifest) + '\n')
PY
tar -czf dist/package/token-monitor-analytics-linux-x64.tar.gz -C dist/server .
(cd dist/package && sha256sum token-monitor-analytics-linux-x64.tar.gz > token-monitor-analytics-linux-x64.tar.gz.sha256)
