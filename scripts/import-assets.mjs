import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

// Candidate asset locations:
// 1. node_modules/brokeworld-asset-pack1/assets
// 2. node_modules/brokeworld-asset-pack1
// 3. ../brokeworld-asset-pack1/assets (local sibling repository fallback)
const candidatePaths = [
  path.join(rootDir, 'node_modules', 'brokeworld-asset-pack1', 'assets'),
  path.join(rootDir, 'node_modules', 'brokeworld-asset-pack1'),
  path.resolve(rootDir, '..', 'brokeworld-asset-pack1', 'assets'),
];

let sourceDir = null;
for (const p of candidatePaths) {
  if (
    fs.existsSync(p) &&
    (fs.existsSync(path.join(p, 'sandy.png')) ||
      fs.existsSync(path.join(p, 'graphics')) ||
      fs.existsSync(path.join(p, 'assets', 'sandy.png')))
  ) {
    if (fs.existsSync(path.join(p, 'assets', 'sandy.png'))) {
      sourceDir = path.join(p, 'assets');
    } else {
      sourceDir = p;
    }
    break;
  }
}

if (!sourceDir) {
  console.warn(
    '[brokeworld] Asset pack not found in node_modules or sibling directory. Assets were not imported.'
  );
  process.exit(0);
}

console.log(`[brokeworld] Importing assets from ${sourceDir} -> ${publicDir}...`);
fs.mkdirSync(publicDir, { recursive: true });

const itemsToCopy = ['sandy.png', 'water-tile.png', 'graphics'];
for (const item of itemsToCopy) {
  const srcItem = path.join(sourceDir, item);
  const dstItem = path.join(publicDir, item);
  if (fs.existsSync(srcItem)) {
    fs.cpSync(srcItem, dstItem, { recursive: true, force: true });
  }
}

console.log('[brokeworld] Assets successfully imported!');
