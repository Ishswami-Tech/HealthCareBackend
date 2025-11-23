#!/usr/bin/env node

/**
 * Check for outdated dependencies
 * Only shows packages that are actually outdated (Current !== Latest)
 */

const { execSync } = require('child_process');

try {
  // Run pnpm outdated and capture output (both stdout and stderr)
  const output = execSync('pnpm outdated', {
    encoding: 'utf8',
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // If no output, try checking if all packages are up to date
  if (!output || output.trim().length === 0) {
    console.log('[OK] All dependencies are up to date!');
    process.exit(0);
  }

  // Parse the table output
  const lines = output.split('\n');
  const outdatedPackages = [];

  // Find the table header and data rows
  let inTable = false;
  let headerFound = false;

  for (const line of lines) {
    // Detect table start
    if (line.includes('Package') && line.includes('Current') && line.includes('Latest')) {
      headerFound = true;
      inTable = true;
      continue;
    }

    // Skip separator lines
    if (line.includes('─') || line.includes('═') || line.trim() === '') {
      if (headerFound && inTable && line.includes('└')) {
        break; // End of table
      }
      continue;
    }

    // Parse data rows (format: │ Package Name │ Current │ Latest │)
    if (inTable && line.includes('│')) {
      const parts = line
        .split('│')
        .map(p => p.trim())
        .filter(p => p);

      if (parts.length >= 3) {
        const name = parts[0];
        const current = parts[1];
        const latest = parts[2];

        // Only include if outdated
        if (current !== latest) {
          outdatedPackages.push({
            name: name.replace(/\s*\(dev\)$/, ''),
            current,
            latest,
            isDev: name.includes('(dev)'),
          });
        }
      }
    }
  }

  if (outdatedPackages.length === 0) {
    console.log('[OK] All dependencies are up to date!');
    process.exit(0);
  }

  // Display filtered results
  console.log('\n┌─────────────────────────────────────────────┬─────────┬─────────┐');
  console.log('│ Package                                     │ Current │ Latest  │');
  console.log('├─────────────────────────────────────────────┼─────────┼─────────┤');

  outdatedPackages.forEach(pkg => {
    const isDev = pkg.isDev ? ' (dev)' : '';
    const nameDisplay = pkg.name.length > 41 ? pkg.name.substring(0, 38) + '...' : pkg.name;
    const namePadded = nameDisplay.padEnd(41);
    const currentPadded = pkg.current.padEnd(7);
    const latestPadded = pkg.latest.padEnd(7);
    console.log(`│ ${namePadded}${isDev.padEnd(7)}│ ${currentPadded} │ ${latestPadded} │`);
  });

  console.log('└─────────────────────────────────────────────┴─────────┴─────────┘');
  console.log(`\nTotal: ${outdatedPackages.length} outdated package(s) found\n`);

  process.exit(0);
} catch (error) {
  // If command fails, just show a message
  console.log('[WARN] Could not check outdated dependencies:', error.message);
  process.exit(0); // Don't fail the build
}
