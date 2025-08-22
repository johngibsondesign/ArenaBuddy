// Simple BOM guard: fail build if a BOM-prefixed postcss config JSON exists in renderer.
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'src', 'renderer', 'postcss.config.json');
if (fs.existsSync(target)) {
  const buf = fs.readFileSync(target);
  const hasBOM = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  if (hasBOM) {
    console.error('Error: postcss.config.json contains a UTF-8 BOM which breaks Vite in CI. Delete or save without BOM.');
    process.exit(1);
  }
}
