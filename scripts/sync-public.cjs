const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'frontend', 'dist');
const dest = path.join(__dirname, '..', 'public');

if (!fs.existsSync(src)) {
  console.error('sync-public: run "npm run build --prefix frontend" first (missing frontend/dist)');
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`sync-public: copied ${src} -> ${dest}`);
