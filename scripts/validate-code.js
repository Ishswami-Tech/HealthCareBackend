#!/usr/bin/env node

/**
 * Consolidated Code Validation Script
 *
 * Performs all code quality and validation checks:
 * 1. Checks for forbidden TypeScript/ESLint suppression comments
 * 2. Checks for TODO/FIXME/XXX/HACK comments
 * 3. Checks for outdated dependencies
 *
 * This script consolidates:
 * - check-forbidden-comments.js
 * - check-todos.js
 * - check-outdated.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

const appRoot = process.cwd();
const srcDir = path.join(appRoot, 'src');

// ============================================================================
// 1. Check Forbidden Comments
// ============================================================================
function checkForbiddenComments() {
  log('\n→ Checking for forbidden TypeScript/ESLint comments...', 'cyan');

  const forbiddenPatterns = [
    {
      pattern: /@ts-ignore/g,
      name: '@ts-ignore',
      reason: 'Type errors must be fixed, not ignored',
    },
    {
      pattern: /@ts-expect-error/g,
      name: '@ts-expect-error',
      reason: 'Type errors must be fixed, not expected',
    },
    {
      pattern: /eslint-disable(?:-next-line|-line)?/g,
      name: 'eslint-disable',
      reason: 'ESLint errors must be fixed, not disabled',
    },
    {
      pattern: /\/\*\s*eslint-disable/g,
      name: 'eslint-disable (block)',
      reason: 'ESLint errors must be fixed, not disabled',
    },
  ];

  const issues = [];

  function checkFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      forbiddenPatterns.forEach(({ pattern, name, reason }) => {
        const matches = line.match(pattern);
        if (matches) {
          const relativePath = path.relative(appRoot, filePath);
          issues.push({
            file: relativePath,
            line: index + 1,
            pattern: name,
            reason,
            code: line.trim(),
          });
        }
      });
    });
  }

  function walkDir(dir) {
    if (!fs.existsSync(dir)) {
      return;
    }

    const files = fs.readdirSync(dir);

    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        if (!['node_modules', 'dist', 'generated', '.git'].includes(file)) {
          walkDir(filePath);
        }
      } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
        if (!filePath.includes('prisma/generated') && !filePath.includes('seed.ts')) {
          checkFile(filePath);
        }
      }
    });
  }

  walkDir(srcDir);

  if (issues.length > 0) {
    log(`\n❌ Found ${issues.length} forbidden comment(s):\n`, 'red');

    issues.forEach(issue => {
      log(`  ${issue.file}:${issue.line}`, 'red');
      log(`    Pattern: ${issue.pattern}`, 'yellow');
      log(`    Reason: ${issue.reason}`, 'yellow');
      log(
        `    Code: ${issue.code.substring(0, 80)}${issue.code.length > 80 ? '...' : ''}`,
        'yellow'
      );
      log('');
    });

    return { success: false, count: issues.length };
  }

  log('  ✓ No forbidden comments found', 'green');
  return { success: true, count: 0 };
}

// ============================================================================
// 2. Check TODO/FIXME Comments
// ============================================================================
function checkTodos() {
  log('\n→ Checking for TODO/FIXME/XXX/HACK comments...', 'cyan');

  const TODO_PATTERNS = [/TODO/i, /FIXME/i, /XXX/i, /HACK/i];
  const IGNORE_DIRS = ['node_modules', 'dist', '.git', 'coverage', 'generated'];
  const IGNORE_FILES = ['.spec.ts', '.test.ts'];

  function shouldIgnore(filePath) {
    const parts = filePath.split(path.sep);
    return (
      IGNORE_DIRS.some(dir => parts.includes(dir)) ||
      IGNORE_FILES.some(ext => filePath.endsWith(ext)) ||
      filePath.includes('prisma/generated') ||
      filePath.includes('generated/client')
    );
  }

  function checkFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      const issues = [];

      lines.forEach((line, index) => {
        TODO_PATTERNS.forEach(pattern => {
          // Skip if TODO/FIXME/XXX/HACK appears in function names or type definitions (not actual comments)
          const trimmedLine = line.trim();
          const isComment =
            trimmedLine.startsWith('//') ||
            trimmedLine.startsWith('/*') ||
            trimmedLine.startsWith('*');
          const isInFunctionName =
            /^(export\s+)?(async\s+)?function\s+.*(TODO|FIXME|XXX|HACK)/i.test(trimmedLine);
          const isInTypeDef =
            /^(export\s+)?(type|interface|class|enum)\s+.*(TODO|FIXME|XXX|HACK)/i.test(trimmedLine);

          if (pattern.test(line) && (isComment || (!isInFunctionName && !isInTypeDef))) {
            issues.push({
              file: filePath,
              line: index + 1,
              content: line.trim(),
              type: pattern.source.replace(/[\/\\^$.*+?()[\]{}|]/g, ''),
            });
          }
        });
      });

      return issues;
    } catch (error) {
      return [];
    }
  }

  function checkDirectory(dir) {
    if (!fs.existsSync(dir)) {
      return [];
    }

    const issues = [];
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        if (!shouldIgnore(fullPath)) {
          issues.push(...checkDirectory(fullPath));
        }
      } else if ((file.endsWith('.ts') || file.endsWith('.js')) && !shouldIgnore(fullPath)) {
        issues.push(...checkFile(fullPath));
      }
    }

    return issues;
  }

  const allIssues = checkDirectory(srcDir);

  if (allIssues.length > 0) {
    log(`\n⚠ Found ${allIssues.length} TODO/FIXME/XXX/HACK comment(s):\n`, 'yellow');
    allIssues.slice(0, 10).forEach(issue => {
      log(`  ${issue.file}:${issue.line} - ${issue.type}`, 'yellow');
      log(
        `    ${issue.content.substring(0, 80)}${issue.content.length > 80 ? '...' : ''}`,
        'yellow'
      );
    });
    if (allIssues.length > 10) {
      log(`  ... and ${allIssues.length - 10} more`, 'yellow');
    }
    log('\n  [WARN] Build continuing. Please address these TODOs when possible.\n', 'yellow');
    return { success: true, count: allIssues.length, warning: true };
  } else {
    log('  ✓ No TODO/FIXME/XXX/HACK comments found', 'green');
    return { success: true, count: 0 };
  }
}

// ============================================================================
// 3. Check Outdated Dependencies
// ============================================================================
function checkOutdated() {
  log('\n→ Checking for outdated dependencies...', 'cyan');

  let outdatedOutput = '';
  try {
    // yarn outdated exits with code 1 when packages are outdated — that's expected
    outdatedOutput = execSync('yarn outdated --json 2>&1', {
      encoding: 'utf8',
      cwd: appRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    outdatedOutput = error.stdout || '';
  }

  if (!outdatedOutput || !outdatedOutput.trim()) {
    log('  ✓ All dependencies are up to date!', 'green');
    return { success: true, count: 0 };
  }

  // yarn outdated --json emits a "table" type JSON line with body rows
  // Columns: [Package, Current, Wanted, Latest, Package Type, URL]
  let outdatedPackages = [];
  const lines = outdatedOutput.trim().split('\n');
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'table' && parsed.data && parsed.data.body) {
        outdatedPackages = parsed.data.body.map(row => ({
          name: row[0],
          current: row[1],
          wanted: row[2],
          latest: row[3],
          type: row[4] || 'dependencies',
        }));
        break;
      }
    } catch {
      continue;
    }
  }

  if (outdatedPackages.length === 0) {
    log('  ✓ All dependencies are up to date!', 'green');
    return { success: true, count: 0 };
  }

  // Separate semver-compatible updates from major-version jumps
  const semverUpdates = outdatedPackages.filter(p => p.current !== p.wanted);
  const majorUpdates = outdatedPackages.filter(
    p => p.current === p.wanted && p.wanted !== p.latest
  );

  log(`\n⚠ Found ${outdatedPackages.length} outdated package(s):\n`, 'yellow');

  if (semverUpdates.length > 0) {
    log('  Semver-compatible (safe to upgrade with: yarn upgrade):', 'yellow');
    semverUpdates.slice(0, 10).forEach(({ name, current, wanted, latest, type }) => {
      const tag = type === 'devDependencies' ? ' (dev)' : '';
      log(`    ${name}${tag}: ${current} → wanted ${wanted}, latest ${latest}`, 'yellow');
    });
    if (semverUpdates.length > 10) log(`    ... and ${semverUpdates.length - 10} more`, 'yellow');
  }

  if (majorUpdates.length > 0) {
    log('\n  Major version jumps (review breaking changes first):', 'yellow');
    majorUpdates.slice(0, 10).forEach(({ name, current, latest, type }) => {
      const tag = type === 'devDependencies' ? ' (dev)' : '';
      log(`    ${name}${tag}: ${current} → ${latest}`, 'yellow');
    });
    if (majorUpdates.length > 10) log(`    ... and ${majorUpdates.length - 10} more`, 'yellow');
  }

  log('');
  return { success: true, count: outdatedPackages.length, warning: true };
}

// ============================================================================
// Main Execution
// ============================================================================
function main() {
  const args = process.argv.slice(2);
  const strictMode = args.includes('--strict') || args.includes('-s');
  const forbiddenOnly = args.includes('--forbidden-only');
  const todosOnly = args.includes('--todos-only');
  const outdatedOnly = args.includes('--outdated-only');

  log('\n' + '='.repeat(60), 'cyan');
  log('Code Validation Script (Consolidated)', 'cyan');
  log('='.repeat(60), 'cyan');

  const results = {};

  if (forbiddenOnly) {
    results.forbidden = checkForbiddenComments();
  } else if (todosOnly) {
    results.todos = checkTodos();
  } else if (outdatedOnly) {
    results.outdated = checkOutdated();
  } else {
    // Run all checks
    results.forbidden = checkForbiddenComments();
    results.todos = checkTodos();
    results.outdated = checkOutdated();
  }

  log('\n' + '='.repeat(60), 'cyan');
  log('Validation Summary:', 'cyan');
  log('='.repeat(60), 'cyan');

  let hasErrors = false;
  let hasWarnings = false;

  if (results.forbidden !== undefined) {
    if (!results.forbidden.success) {
      log('❌ Forbidden comments: FAILED', 'red');
      hasErrors = true;
    } else {
      log('✓ Forbidden comments: OK', 'green');
    }
  }

  if (results.todos !== undefined) {
    if (results.todos.warning) {
      log(`⚠ TODO comments: ${results.todos.count} found (warning only)`, 'yellow');
      hasWarnings = true;
    } else {
      log('✓ TODO comments: OK', 'green');
    }
  }

  if (results.outdated !== undefined) {
    if (results.outdated.warning) {
      log(`⚠ Outdated packages: ${results.outdated.count} found (warning only)`, 'yellow');
      hasWarnings = true;
    } else {
      log('✓ Outdated packages: OK', 'green');
    }
  }

  log('', 'reset');

  if (hasErrors) {
    log('❌ Validation failed! Please fix the errors above.\n', 'red');
    process.exit(1);
  }

  if (hasWarnings && strictMode) {
    log('⚠ Validation completed with warnings (strict mode enabled)\n', 'yellow');
    process.exit(1);
  }

  log('✅ All validations passed!\n', 'green');
  process.exit(0);
}

main();
