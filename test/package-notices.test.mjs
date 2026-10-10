import { throws, deepStrictEqual } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkPackageNotices } from "../scripts/check-package-notices.mjs";

const notice = readFileSync(new URL("../LICENSE", import.meta.url));
const packages = [
  [".", "foldkit-native"],
  ["packages/foldkit-gpuix", "foldkit-gpuix"],
  ["packages/ui", "@foldkit-native/ui"],
];

function fixture(run, omit, altered) {
  const root = mkdtempSync(join(tmpdir(), "foldkit-notice-fixture-"));
  try {
    for (const [directory, name] of packages) {
      const cwd = join(root, directory);
      mkdirSync(cwd, { recursive: true });
      writeFileSync(join(cwd, "package.json"), JSON.stringify({
        name, version: "0.0.0", private: true, license: "MIT",
        // A pack check must not execute package lifecycle scripts.
        scripts: { prepack: "node -e 'process.exit(1)'" },
      }));
      if (directory !== omit) {
        writeFileSync(join(cwd, "LICENSE"), directory === altered
          ? Buffer.from(notice.toString().replace("Manzanita Research", "Changed copyright"))
          : notice);
      }
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("actual project archives contain the full notice and preserve metadata", { timeout: 60_000 }, () => {
  deepStrictEqual(checkPackageNotices(), packages.map(([, name]) => ({
    name, noticeBytes: notice.length,
  })));
});

test("actual fixture archives contain the full notice and preserve metadata", { timeout: 60_000 }, () => {
  fixture(root => deepStrictEqual(checkPackageNotices(root), packages.map(([, name]) => ({
    name, noticeBytes: notice.length,
  }))));
});

for (const [directory, name] of packages.slice(1)) {
  test(`actual archive check rejects an omitted ${name} notice`, { timeout: 60_000 }, () => {
    fixture(root => throws(() => checkPackageNotices(root), {
      message: `${name}: archive omits package/LICENSE`,
    }), directory);
  });
}

test("actual archive check rejects a changed copyright", { timeout: 60_000 }, () => {
  fixture(root => throws(() => checkPackageNotices(root), {
    message: "@foldkit-native/ui: packed LICENSE differs from root LICENSE",
  }), undefined, "packages/ui");
});
