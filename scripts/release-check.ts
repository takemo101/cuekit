#!/usr/bin/env bun
// Pre-tag check that the published bundle (`bin/cuekit.js`) is in sync
// with the current workspace version. Catches the v0.0.2 / v0.0.3 class
// of bug where the version got bumped in package.json but the bundled
// bin file (which is what `package.json#bin.cuekit` points at) was not
// regenerated, causing `bun install -g github:takemo101/cuekit#vX.Y.Z`
// to silently install a stale bundle that reported the OLD version
// from its baked-in package.json copy.
//
// Run via `bun run release:check` before pushing a release tag. Exits
// non-zero if the bundle is out of sync.
//
// Steps:
// 1. Read the canonical version from `packages/cli/package.json`.
//    (`packages/cli/package.json` is what `cuekit doctor` reads at
//    runtime via `import pkg from "../package.json"`.)
// 2. Re-run `bun run bundle` so the bundle reflects the current source.
// 3. Fail if `bin/cuekit.js` has uncommitted changes — that means the
//    committed bundle was stale and the operator must commit the
//    regenerated bundle before tagging.
// 4. Fail if the bundle does not contain the expected version string,
//    as a paranoid double check that the bundler picked up the right
//    package.json.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CLI_PACKAGE_JSON = join(import.meta.dir, "..", "packages", "cli", "package.json");
const BUNDLE_PATH = join(import.meta.dir, "..", "bin", "cuekit.js");

function fail(message: string): never {
	console.error(`✗ ${message}`);
	process.exit(1);
}

function ok(message: string): void {
	console.log(`✓ ${message}`);
}

const cliPackage = JSON.parse(readFileSync(CLI_PACKAGE_JSON, "utf8"));
const expectedVersion = cliPackage.version as string;
if (typeof expectedVersion !== "string" || expectedVersion.length === 0) {
	fail(`could not read version from ${CLI_PACKAGE_JSON}`);
}
ok(`workspace version: ${expectedVersion}`);

const bundle = spawnSync("bun", ["run", "bundle"], { stdio: "inherit" });
if (bundle.status !== 0) {
	fail(`bun run bundle exited ${bundle.status}`);
}
ok("bundle regenerated");

const diff = spawnSync("git", ["diff", "--exit-code", "--quiet", BUNDLE_PATH]);
if (diff.status !== 0) {
	const stat = spawnSync("git", ["diff", "--stat", BUNDLE_PATH], { encoding: "utf8" });
	console.error(stat.stdout ?? "");
	fail(
		"bin/cuekit.js is out of sync with current source — the committed bundle was stale. " +
			"Run `bun run bundle`, commit the regenerated bin/cuekit.js, then re-run release:check.",
	);
}
ok("bundle is committed (no uncommitted changes)");

const bundleContent = readFileSync(BUNDLE_PATH, "utf8");
const versionMarker = `version: "${expectedVersion}"`;
if (!bundleContent.includes(versionMarker)) {
	fail(
		`bin/cuekit.js does not contain expected ${versionMarker}. ` +
			"The bundler may have picked up a different package.json — investigate before tagging.",
	);
}
ok(`bundle contains ${versionMarker}`);

console.log(`\nrelease-check passed for v${expectedVersion}`);
