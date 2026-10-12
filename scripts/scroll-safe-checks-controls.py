import sys
sys.dont_write_bytecode = True

import importlib.util
from pathlib import Path
import re
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('scroll_safe_checks', ROOT / 'scripts/scroll-safe-checks.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class SelectionControls(unittest.TestCase):
    def rejected_before_spawn(self, root, command, environment=None):
        started = []
        with self.assertRaises(policy.Rejected):
            policy.run(root, command, execute=lambda *args, **kwargs: started.append(args), environment=environment or {})
        self.assertEqual(started, [])

    def test_inspected_named_commands_are_allowed(self):
        for command in policy.CHECKS.values():
            with self.subTest(command=command):
                self.assertTrue(policy.audit(ROOT, command, {})['accepted'])

    def test_unsafe_selections_never_start_a_child(self):
        bad = [
            ('bun', 'test'),
            ('bun', 'test', 'packages/foldkit-gpuix/test/keyboard.test.ts'),
            ('bun', 'test', 'packages/foldkit-gpuix/test/metal.test.ts'),
            ('bun', 'test', 'packages/foldkit-gpuix/test/window.test.ts'),
            ('bun', 'test', 'examples/big-list/native.test.ts'),
            ('bun', 'test', 'examples/pixel-art/native.test.ts'),
            ('bun', 'test', 'packages/foldkit-gpuix/test/events.test.ts'),
            ('bun', 'test', 'packages/foldkit-gpuix/test/events.test.ts', '-t', '.*'),
            ('bun', 'test', 'packages/foldkit-gpuix/test'),
            ('bun', 'test', 'packages/foldkit-gpuix/test/*.test.ts'),
            (*policy.CHECKS['focused'], 'packages/foldkit-gpuix/test/keyboard.test.ts'),
            (*policy.CHECKS['scroll'], '--preload', 'unreviewed.ts'),
            ('bun', 'run', 'css'),
            ('bunx', 'vitest'),
        ]
        for command in bad:
            with self.subTest(command=command):
                self.rejected_before_spawn(ROOT, command)

    def test_runtime_injection_is_rejected_before_spawn(self):
        for name in ('BUN_OPTIONS', 'BUN_PRELOAD', 'NODE_OPTIONS'):
            self.rejected_before_spawn(ROOT, policy.CHECKS['focused'], {name: '--preload native.ts'})

    def test_missing_changed_and_escaped_sources_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.rejected_before_spawn(root, policy.CHECKS['focused'])
            for name in policy.FINGERPRINTS:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes((ROOT / name).read_bytes())
            self.assertTrue(policy.audit(root, policy.CHECKS['focused'], {})['accepted'])
            target = root / 'packages/foldkit-gpuix/test/scroll-guard.test.ts'
            target.write_text(target.read_text() + '\nopenMetal()\n')
            self.rejected_before_spawn(root, policy.CHECKS['focused'])
            target.unlink(); target.symlink_to(ROOT / 'packages/foldkit-gpuix/test/scroll-guard.test.ts')
            self.rejected_before_spawn(root, policy.CHECKS['focused'])

    def test_only_the_exact_anchored_headless_event_filter_is_admitted(self):
        for title in ('dispatch (WHATWG DOM)', 'hover: where the pointer is', 'presses and clicks', 'pointer capture', 'the wheel', 'default actions', 'focus:', 'restyles:'):
            self.assertIsNotNone(re.search(policy.EVENTS, title))
        self.assertIsNone(re.search(policy.EVENTS, 'real GPUI (Metal): what its dispatch decides'))
        self.rejected_before_spawn(ROOT, (*policy.CHECKS['events'][:-1], 'hover:|the wheel'))

    def test_accepted_spawn_uses_the_audited_command_receiver_and_no_shell(self):
        calls = []
        result = object()
        def execute(*args, **kwargs):
            calls.append((args, kwargs))
            return result
        self.assertIs(policy.run(ROOT, policy.CHECKS['scroll'], execute, {}), result)
        self.assertEqual(calls, [((['rtk', 'proxy', *policy.CHECKS['scroll']],), {'cwd': str(ROOT.resolve()), 'env': {}, 'shell': False, 'check': False})])


if __name__ == '__main__':
    unittest.main()
