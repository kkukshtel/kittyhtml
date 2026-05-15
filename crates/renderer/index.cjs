// Platform-specific loader for the kittyhtml native renderer.
// Selects the right prebuilt .node file based on process.platform and process.arch.
//
// When packaged for npm, the .node files live in platform-specific subpackages
// (npm/darwin-arm64, npm/linux-x64-gnu, etc.) and are resolved via optionalDependencies.
// During local development, the build sits next to this file.

const { existsSync } = require('node:fs');
const { join } = require('node:path');

const platform = process.platform;
const arch = process.arch;
const libc = (() => {
  if (platform !== 'linux') return '';
  // Best-effort: assume gnu unless musl is hinted. CI builds will use named
  // subpackages so this guess only matters during local dev on Linux.
  try {
    const { familySync, GLIBC, MUSL } = require('detect-libc');
    const fam = familySync();
    return fam === MUSL ? '-musl' : '-gnu';
  } catch {
    return '-gnu';
  }
})();

const target = `${platform}-${arch}${libc}`;
const localBinary = join(__dirname, `kittyhtml-native.${target}.node`);

let mod;
if (existsSync(localBinary)) {
  mod = require(localBinary);
} else {
  try {
    mod = require(`kittyhtml-${target}`);
  } catch (err) {
    throw new Error(
      `kittyhtml: no prebuilt native binary for ${target}. ` +
        `Tried ${localBinary} and the kittyhtml-${target} package. ` +
        `If you're on an unsupported platform, please file an issue.`,
    );
  }
}

module.exports = mod;
