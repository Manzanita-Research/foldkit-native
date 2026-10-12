import { deepStrictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const packages = [".", "packages/foldkit-gpuix", "packages/ui"];

// Inspect real archives, without running lifecycle scripts or leaving tarballs
// in the source tree. The root notice is the authoritative byte-for-byte copy.
export function checkPackageNotices(root = projectRoot) {
  const notice = readFileSync(join(root, "LICENSE"));
  const artifacts = mkdtempSync(join(tmpdir(), "foldkit-package-notices-"));
  const results = [];
  try {
    for (const directory of packages) {
      const cwd = join(root, directory);
      const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
      const [pack] = JSON.parse(execFileSync("npm", [
        "pack", "--ignore-scripts", "--json", "--pack-destination", artifacts,
      ], { cwd, encoding: "utf8", timeout: 60_000 }));
      const archive = join(artifacts, pack.filename);
      const entries = execFileSync("tar", ["-tzf", archive], {
        encoding: "utf8", timeout: 60_000,
      }).split("\n");
      if (!entries.includes("package/LICENSE")) {
        throw new Error(`${manifest.name}: archive omits package/LICENSE`);
      }
      const packedNotice = execFileSync("tar", ["-xOf", archive, "package/LICENSE"], {
        timeout: 60_000,
      });
      if (!packedNotice.equals(notice)) {
        throw new Error(`${manifest.name}: packed LICENSE differs from root LICENSE`);
      }
      const packedManifest = JSON.parse(execFileSync("tar", [
        "-xOf", archive, "package/package.json",
      ], { encoding: "utf8", timeout: 60_000 }));
      deepStrictEqual(packedManifest, manifest, `${manifest.name}: packed metadata changed`);
      deepStrictEqual(packedManifest.license, "MIT", `${manifest.name}: license metadata`);
      results.push({ name: manifest.name, noticeBytes: notice.length });
    }
    return results;
  } finally {
    rmSync(artifacts, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const result of checkPackageNotices()) {
    console.log(`${result.name}: packed LICENSE matches root (${result.noticeBytes} bytes)`);
  }
}
