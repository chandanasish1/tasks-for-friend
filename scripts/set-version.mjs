// Single-source version bump. package.json is the source of truth; this
// script propagates one version everywhere it must appear:
//   - package.json + package-lock.json
//   - src/version.mjs           (displayed in the app UI + console)
//   - android/app/build.gradle  (versionName + versionCode)
//   - manifest.json             (PWA manifest version)
//   - sw.js                     (cache name -> old web caches purge on update)
//
// Usage:   npm run set-version -- 1.6.0
// Release: commit everything, then (annotated tag — --follow-tags skips
//          lightweight ones)
//          git tag -a v1.6.0 -m v1.6.0 && git push --follow-tags
//          gh release create v1.6.0 TASKS-v1.6.0-debug.apk --notes "..."
//
// versionCode = major*10000 + minor*100 + patch (1.5.0 -> 10500), so Play/
// device installs always see a monotonically increasing integer.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2] || '';
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);

if (!match) {
    console.error('Usage: npm run set-version -- <major.minor.patch>   e.g. 1.5.0');
    process.exit(1);
}

const major = Number(match[1]);
const minor = Number(match[2]);
const patch = Number(match[3]);
const versionCode = major * 10000 + minor * 100 + patch;

execSync(`npm version ${version} --no-git-tag-version --allow-same-version`, { cwd: root, stdio: 'inherit' });

writeFileSync(path.join(root, 'src', 'version.mjs'), `export const APP_VERSION = '${version}';\n`);

const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
let gradle = readFileSync(gradlePath, 'utf8');
gradle = gradle.replace(/versionCode \d+/, `versionCode ${versionCode}`);
gradle = gradle.replace(/versionName "[^"]*"/, `versionName "${version}"`);
writeFileSync(gradlePath, gradle);

const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);

const swPath = path.join(root, 'sw.js');
let sw = readFileSync(swPath, 'utf8');
sw = sw.replace(/const CACHE_NAME = 'tasks-app-v[^']*';/, `const CACHE_NAME = 'tasks-app-v${version}';`);
writeFileSync(swPath, sw);

console.log(`Version set to ${version} (android versionCode ${versionCode}) in package.json, src/version.mjs, android/app/build.gradle, manifest.json, sw.js`);
