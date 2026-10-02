const fs = require('node:fs');
const path = require('node:path');

// Capacitor 5 expects tar's CommonJS default export. tar 7 exposes named
// exports, so keep the security update and adapt the legacy CLI import.
let manifestPath;
try {
  manifestPath = require.resolve('@capacitor/cli/package.json');
} catch (error) {
  if (error.code === 'MODULE_NOT_FOUND') process.exit(0); // Production-only install.
  throw error;
}
const { version } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!version.startsWith('5.')) {
  throw new Error('Review/remove the Capacitor 5 tar compatibility patch after upgrading the CLI.');
}
const templatePath = path.join(path.dirname(manifestPath), 'dist/util/template.js');
const original = 'const tar_1 = tslib_1.__importDefault(require("tar"));';
const replacement = 'const tar_1 = { default: require("tar") };';
const source = fs.readFileSync(templatePath, 'utf8');
if (source.includes(original)) {
  fs.writeFileSync(templatePath, source.replace(original, replacement));
} else if (!source.includes(replacement)) {
  throw new Error('Unexpected Capacitor tar import; review the compatibility patch.');
}
