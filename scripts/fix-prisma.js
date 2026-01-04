#!/usr/bin/env node

/**
 * Consolidated Prisma Fix Script
 *
 * Handles all Prisma-related fixes:
 * 1. Creates sourcemap files for Prisma runtime JS (prevents SWC warnings)
 * 2. Fixes TypeScript type annotations in generated Prisma files
 * 3. Verifies Prisma Client path resolution (yarn/npm - no pnpm support needed)
 *
 * This script consolidates:
 * - fix-prisma-sourcemaps.js
 * - fix-prisma-types.ts
 * - fix-prisma-pnpm.js (simplified for yarn-only)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

const appRoot = path.resolve(__dirname, '..');

// ============================================================================
// 1. Fix Prisma Sourcemaps
// ============================================================================
function fixPrismaSourcemaps() {
  log('\n→ Fixing Prisma sourcemaps...', 'cyan');

  const runtimeDir = path.join(
    appRoot,
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
    log('  ⚠ Runtime directory not found, skipping sourcemap fixes', 'yellow');
    return { success: true, skipped: true };
  }

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

  const filesToFix = ['client.js', 'index-browser.js', 'wasm-compiler-edge.js'];
  let fixedCount = 0;

  filesToFix.forEach(file => {
    const mapPath = path.join(runtimeDir, `${file}.map`);
    if (!fs.existsSync(mapPath)) {
      ensureSourcemap(runtimeDir, file);
      fixedCount++;
    }
  });

  if (fixedCount > 0) {
    log(`  ✓ Created ${fixedCount} sourcemap file(s)`, 'green');
  } else {
    log('  ✓ All sourcemaps already exist', 'green');
  }

  return { success: true, fixed: fixedCount };
}

// ============================================================================
// 2. Fix Prisma TypeScript Types
// ============================================================================
function fixPrismaTypes() {
  log('\n→ Fixing Prisma TypeScript type annotations...', 'cyan');

  const generatedDir = path.join(
    appRoot,
    'src',
    'libs',
    'infrastructure',
    'database',
    'prisma',
    'generated',
    'client',
    'internal'
  );

  if (!fs.existsSync(generatedDir)) {
    log('  ⚠ Generated directory not found, skipping type fixes', 'yellow');
    return { success: true, skipped: true };
  }

  const filesToFix = ['prismaNamespace.ts', 'prismaNamespaceBrowser.ts'];

  function fixTypeAnnotations(filePath, fileName) {
    if (!fs.existsSync(filePath)) {
      log(`  ⚠ File not found: ${fileName}`, 'yellow');
      return false;
    }

    let content = fs.readFileSync(filePath, 'utf-8');
    let modified = false;

    // Fix DbNull export
    if (content.includes('export const DbNull = runtime.DbNull')) {
      content = content.replace(
        /export const DbNull = runtime\.DbNull(\s|$)/g,
        'export const DbNull: typeof runtime.DbNull = runtime.DbNull$1'
      );
      modified = true;
    }

    // Fix JsonNull export
    if (content.includes('export const JsonNull = runtime.JsonNull')) {
      content = content.replace(
        /export const JsonNull = runtime\.JsonNull(\s|$)/g,
        'export const JsonNull: typeof runtime.JsonNull = runtime.JsonNull$1'
      );
      modified = true;
    }

    // Fix AnyNull export
    if (content.includes('export const AnyNull = runtime.AnyNull')) {
      content = content.replace(
        /export const AnyNull = runtime\.AnyNull(\s|$)/g,
        'export const AnyNull: typeof runtime.AnyNull = runtime.AnyNull$1'
      );
      modified = true;
    }

    // Fix NullableJsonNullValueInput (only in prismaNamespace.ts)
    if (fileName === 'prismaNamespace.ts') {
      if (content.includes('export const NullableJsonNullValueInput = {')) {
        content = content.replace(
          /export const NullableJsonNullValueInput = \{[\s\S]{0,500}?\} as const/g,
          match => {
            return match.replace(
              /export const NullableJsonNullValueInput =/,
              'export const NullableJsonNullValueInput: { DbNull: typeof runtime.DbNull; JsonNull: typeof runtime.JsonNull } ='
            );
          }
        );
        modified = true;
      }

      // Fix JsonNullValueInput
      if (content.includes('export const JsonNullValueInput = {')) {
        content = content.replace(
          /export const JsonNullValueInput = \{[\s\S]{0,500}?\} as const/g,
          match => {
            return match.replace(
              /export const JsonNullValueInput =/,
              'export const JsonNullValueInput: { JsonNull: typeof runtime.JsonNull } ='
            );
          }
        );
        modified = true;
      }

      // Fix JsonNullValueFilter
      if (content.includes('export const JsonNullValueFilter = {')) {
        content = content.replace(
          /export const JsonNullValueFilter = \{[\s\S]{0,500}?\} as const/g,
          match => {
            return match.replace(
              /export const JsonNullValueFilter =/,
              'export const JsonNullValueFilter: { DbNull: typeof runtime.DbNull; JsonNull: typeof runtime.JsonNull; AnyNull: typeof runtime.AnyNull } ='
            );
          }
        );
        modified = true;
      }
    }

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf-8');
      log(`  ✓ Fixed type annotations in ${fileName}`, 'green');
      return true;
    }

    return false;
  }

  let fixedCount = 0;
  for (const fileToFix of filesToFix) {
    const filePath = path.join(generatedDir, fileToFix);
    if (fixTypeAnnotations(filePath, fileToFix)) {
      fixedCount++;
    }
  }

  if (fixedCount === 0) {
    log('  ✓ No type fixes needed', 'green');
  }

  return { success: true, fixed: fixedCount };
}

// ============================================================================
// 3. Verify Prisma Client Path Resolution (yarn/npm compatibility)
// ============================================================================
function verifyPrismaPathResolution() {
  log('\n→ Verifying Prisma Client path resolution...', 'cyan');

  // Check if we're using pnpm (we don't, but check anyway)
  const pnpmPath = path.join(appRoot, 'node_modules', '.pnpm');

  if (fs.existsSync(pnpmPath)) {
    log(
      '  ⚠ pnpm detected - this project uses yarn, pnpm compatibility fixes not needed',
      'yellow'
    );
    return { success: true, skipped: true };
  }

  // For yarn/npm, Prisma Client should be in node_modules/.prisma/client
  const prismaClientPath = path.join(appRoot, 'node_modules', '.prisma', 'client');
  if (fs.existsSync(prismaClientPath)) {
    log('  ✓ Prisma Client found in standard location (yarn/npm)', 'green');
    return { success: true, verified: true };
  }

  log(
    '  ⚠ Prisma Client not found in node_modules/.prisma/client (may be generated during build)',
    'yellow'
  );
  return { success: true, skipped: true };
}

// ============================================================================
// Main Execution
// ============================================================================
function main() {
  log('\n' + '='.repeat(60), 'cyan');
  log('Prisma Fix Script (Consolidated)', 'cyan');
  log('='.repeat(60), 'cyan');

  const results = {
    sourcemaps: fixPrismaSourcemaps(),
    types: fixPrismaTypes(),
    pathResolution: verifyPrismaPathResolution(),
  };

  log('\n' + '='.repeat(60), 'cyan');
  log('Summary:', 'cyan');
  log('='.repeat(60), 'cyan');

  if (results.sourcemaps.success) {
    log('✓ Sourcemaps: OK', 'green');
  }
  if (results.types.success) {
    log('✓ Type annotations: OK', 'green');
  }
  if (results.pathResolution.success) {
    log('✓ Path resolution: OK', 'green');
  }

  log('\n✅ All Prisma fixes completed!\n', 'green');
  process.exit(0);
}

main();
