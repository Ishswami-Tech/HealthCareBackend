#!/usr/bin/env node

const madge = require('madge');

async function main() {
  const args = process.argv.slice(2);
  const isCircular = args.includes('--circular');
  const imageIdx = args.indexOf('--image');
  const imageFile = imageIdx >= 0 ? args[imageIdx + 1] : null;

  const result = await madge('src', {
    tsConfig: './tsconfig.json',
    fileExtensions: ['ts'],
    excludeRegExp: ['prisma/generated', 'libs/core/types', '/index.ts$', '\\.module\\.ts$'],
  });

  if (imageFile) {
    await result.image(imageFile);
    console.log(`Graph written to ${imageFile}`);
    return;
  }

  if (isCircular) {
    const cycles = result.circular();
    if (cycles.length === 0) {
      console.log('No circular dependency found.');
      return;
    }
    console.log(`Found ${cycles.length} circular dependencies:`);
    cycles.forEach((cycle, idx) => {
      console.log(`${idx + 1}) ${cycle.join(' > ')}`);
    });
    process.exitCode = 1;
    return;
  }

  // Default: print dependency object keys count + summary-like output
  const graph = result.obj();
  const modules = Object.keys(graph);
  console.log(`Processed ${modules.length} modules.`);
}

main().catch(error => {
  console.error('[run-madge] Failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
