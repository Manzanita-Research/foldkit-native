# Local-only allowlist for the source-reviewed slow-scroll preparation.
# This audits exact commands and inspected source snapshots before any spawn.
# It is not a general test runner or native qualification/identity authority.
import sys
sys.dont_write_bytecode = True

import hashlib
import json
import os
from pathlib import Path
import subprocess

EVENTS = '^(dispatch|hover:|presses and clicks|pointer capture|the wheel|default actions|focus:|restyles:)'
CHECKS = {
    'scroll': ('bun', 'test', 'packages/foldkit-gpuix/test/scroll-guard.test.ts'),
    'focused': ('bun', 'test', 'packages/foldkit-gpuix/test/scroll-guard.test.ts', 'packages/foldkit-gpuix/test/geometry.test.ts', 'packages/foldkit-gpuix/test/automation-secrets.test.ts', 'packages/foldkit-gpuix/test/privacy-integration.test.ts'),
    # The exact anchored filter excludes the file's real-GPUI describe block.
    'events': ('bun', 'test', 'packages/foldkit-gpuix/test/events.test.ts', '-t', EVENTS),
    'typecheck': ('bun', 'run', 'typecheck'),
    'css': ('bun', 'run', 'css', '--check'),
    'diff': ('git', 'diff', '--check'),
}
FINGERPRINTS = {'bunfig.toml': '2b9303e9892be8e3aada7a5036d17d9d13820cb34878eaf527927d337d014bba',
 'test/support/dom.ts': '4c199816d8e8803091398c71264655cc4daf555801d9ec946c2d82985e018c0c',
 'packages/foldkit-gpuix/test/scroll-guard.test.ts': 'f6014368326c25417ef44cb1edd3763916d9151e1d4a3321b9e292c9b5a8b39d',
 'packages/foldkit-gpuix/test/geometry.test.ts': '6ee1f798163a691ae2a3f3903320415b4e430bd60ffc3a433cf62dd3e80ce9a8',
 'packages/foldkit-gpuix/test/automation-secrets.test.ts': 'e9e82c37303c6525d6dd9d146a0a9f549a40451dc657269465ae338f9a9ac975',
 'packages/foldkit-gpuix/test/privacy-integration.test.ts': '8e37932b12b43294d34ec9c0dcf0adeda71df6faaa01e48fedd4e5fa84e60af1',
 'packages/foldkit-gpuix/test/events.test.ts': '56e444ea025f7137d9dad2b8423a6530e39cd65a5fe18b2a431c20b954ffd5b2',
 'packages/foldkit-gpuix/test/support.ts': '9611e874ca4e1954030c22125d896b5f195197ac2abebab041cf7a730c1d78ee',
 'packages/foldkit-gpuix/src/host.ts': '2a67355e55323b6fdcf53e8c2ca91e5ddaefbbc3c42c09482823f11a69783963',
 'packages/foldkit-gpuix/src/index.ts': '3336cded0bc38b962165d4cbd6224a964a83b6ccaedeacc74179570fe03f5912',
 'packages/foldkit-gpuix/src/layout.ts': '18a5ec2a19cff7a8b076806286cd20ec7e3052582b35bba8f5038c706fa2f7b0',
 'packages/foldkit-gpuix/src/dom.ts': '5128e770da8117be8df46de01507ef8e7ce963295e173ed5c966e1e7c4d13c18',
 'test/support/fake-gpui.ts': '7246def6cdc9cd62adc8efda334e1b3e21f36b5709e150ded6587d466277d895',
 'scripts/css.ts': 'ec58287e7a1ff1e0f9ced37220da50c9dfccf74eb7235de199255224576b90e8',
 'package.json': 'f66e710d975d40a2ba81fe8f75518a70c4a15bfb54d144b8d12db05c4763ecbf',
 'package-lock.json': '93535904b69ec9f551e120066edca66d3488d5969f6b3c3fb464474a583181c8',
 'tsconfig.json': '36536b15f23a96605cf4fa26bec51253669eda2018c6c00e6b8feb935b025951'}

class Rejected(ValueError):
    pass

def audit(root, command, environment=None):
    command = tuple(command)
    if command not in CHECKS.values():
        raise Rejected('Command is outside the explicit non-native allowlist')
    environment = os.environ if environment is None else environment
    for name in ('BUN_OPTIONS', 'BUN_PRELOAD', 'NODE_OPTIONS'):
        if environment.get(name):
            raise Rejected('Unreviewed runtime injection: ' + name)
    root = Path(root).resolve()
    for name, expected in FINGERPRINTS.items():
        path = root / name
        if not path.is_file() or not path.resolve().is_relative_to(root):
            raise Rejected('Missing or escaped inspected source: ' + name)
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise Rejected('Inspected source changed: ' + name)
    return {'accepted': True, 'command': list(command), 'root': str(root), 'auditedFiles': len(FINGERPRINTS), 'selectionOnly': True, 'nativeQualification': False}

def run(root, command, execute=subprocess.run, environment=None):
    environment = os.environ if environment is None else environment
    result = audit(root, command, environment)
    # No shell, arbitrary flags, glob, directory selection or unfiltered mixed
    # test file. Validation above must finish before a child can be started.
    return execute(['rtk', 'proxy', *result['command']], cwd=result['root'], env=dict(environment), shell=False, check=False)

if __name__ == '__main__':
    # Audit-only is the default; running requires a named allowlisted check.
    if len(sys.argv) not in (2, 3) or sys.argv[1] not in CHECKS or (len(sys.argv) == 3 and sys.argv[2] != '--run'):
        raise SystemExit('Usage: python3 scripts/scroll-safe-checks.py CHECK [--run]')
    root = Path(__file__).resolve().parents[1]
    try:
        if len(sys.argv) == 2:
            print(json.dumps(audit(root, CHECKS[sys.argv[1]])))
        else:
            raise SystemExit(run(root, CHECKS[sys.argv[1]]).returncode)
    except Rejected as error:
        raise SystemExit(str(error))
