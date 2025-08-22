// BOM guard: detect & optionally strip UTF-8 BOM from config JSONs that can break Vite/PostCSS parsing in CI.
const fs = require('fs');
const path = require('path');

function hasBOM(buf) {
  return buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
}

// Scan renderer directory for suspicious config files.
const rendererDir = path.join(__dirname, '..', 'src', 'renderer');
if (fs.existsSync(rendererDir)) {
  const files = fs.readdirSync(rendererDir);
  files.filter(f => /postcss\.config\.(json|cjs|js)$/i.test(f)).forEach(f => {
    const full = path.join(rendererDir, f);
    const buf = fs.readFileSync(full);
    if (hasBOM(buf)) {
      // Auto-strip BOM for JSON; for JS we just rewrite.
      fs.writeFileSync(full, buf.slice(3));
      console.warn(`[prebuild] Stripped UTF-8 BOM from ${path.relative(process.cwd(), full)}`);
    }
  });
}

// Also ensure root package.json has no BOM (can confuse some tooling in edge cases)
const pkgPath = path.join(__dirname, '..', 'package.json');
if (fs.existsSync(pkgPath)) {
  const buf = fs.readFileSync(pkgPath);
  if (hasBOM(buf)) {
    fs.writeFileSync(pkgPath, buf.slice(3));
    console.warn('[prebuild] Stripped UTF-8 BOM from package.json');
  }
}
