const fs = require('fs');
const path = require('path');

/**
 * Creates minimal sourcemap files for Prisma runtime JS.
 *
 * This prevents SWC from warning about missing "*.js.map" files referenced by
 * `//# sourceMappingURL=...` comments in generated Prisma runtime files.
 */
function ensureSourcemap(runtimeDir, jsFileName) {
  const jsPath = path.join(runtimeDir, jsFileName);
  const mapPath = `${jsPath}.map`;

  if (!fs.existsSync(jsPath)) {
    return;
  }

  if (fs.existsSync(mapPath)) {
    return;
  }

  const map = {
    version: 3,
    file: jsFileName,
    sources: [jsFileName],
    names: [],
    mappings: '',
  };

  fs.writeFileSync(mapPath, `${JSON.stringify(map)}\n`, { encoding: 'utf8' });
}

function main() {
  const runtimeDir = path.join(
    __dirname,
    '..',
    'src',
    'libs',
    'infrastructure',
    'database',
    'prisma',
    'generated',
    'client',
    'runtime'
  );

  if (!fs.existsSync(runtimeDir)) {
    return;
  }

  // These are the files that trigger SWC "failed to read input source map" warnings.
  ensureSourcemap(runtimeDir, 'client.js');
  ensureSourcemap(runtimeDir, 'index-browser.js');
  ensureSourcemap(runtimeDir, 'wasm-compiler-edge.js');
}

main();

