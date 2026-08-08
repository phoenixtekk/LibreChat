const fs = require('fs-extra');

async function postBuild() {
  try {
    await fs.copy('public/assets', 'dist/assets');
    await fs.copy('public/robots.txt', 'dist/robots.txt');
    await fs.copy('public/landing.html', 'dist/landing.html');
    for (const page of ['features.html', 'pricing.html', 'help.html']) {
      if (await fs.pathExists(`public/${page}`)) {
        await fs.copy(`public/${page}`, `dist/${page}`);
      }
    }
    console.log('✅ PWA icons, robots.txt, and marketing pages copied successfully.');
  } catch (err) {
    console.error('❌ Error copying files:', err);
    process.exit(1);
  }
}

postBuild();
