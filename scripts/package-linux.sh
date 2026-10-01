#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $(uname -m) == x86_64 ]] || { echo 'Linux x64 is required' >&2; exit 1; }
[[ -f dist/server/MultiTokenMonitor.dll && -f dist/server/wwwroot/index.html ]]
mkdir -p dist/package
cp LICENSE dist/server/LICENSE
python3 - <<'PY'
import json, os, pathlib, re, subprocess
root = pathlib.Path('.')
version = os.environ.get('RELEASE_VERSION') or 'v' + json.loads((root / 'package.json').read_text())['version']
if not re.fullmatch(r'v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version):
    raise ValueError('Invalid release version')
if os.environ.get('RELEASE_VERSION'):
    tagged_revision = subprocess.check_output(['git', 'rev-parse', f'refs/tags/{version}^{{commit}}'], text=True).strip()
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    if tagged_revision != revision:
        raise ValueError('Release tag does not point to HEAD')
manifest = {
    'version': version,
    'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
    'platform': 'linux-x64',
}
(root / 'dist/server/release.json').write_text(json.dumps(manifest) + '\n')
PY
tar -czf dist/package/token-monitor-analytics-linux-x64.tar.gz -C dist/server .
(cd dist/package && sha256sum token-monitor-analytics-linux-x64.tar.gz > token-monitor-analytics-linux-x64.tar.gz.sha256)
