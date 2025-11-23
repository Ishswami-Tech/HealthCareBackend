#!/usr/bin/env node

/**
 * Check for TODO/FIXME/XXX/HACK comments in source code
 * Warns if any are found but does not fail the build
 */

const fs = require('fs');
const path = require('path');

const TODO_PATTERNS = [/TODO/i, /FIXME/i, /XXX/i, /HACK/i];
const IGNORE_DIRS = ['node_modules', 'dist', '.git', 'coverage'];
const IGNORE_FILES = ['.spec.ts', '.test.ts'];

function shouldIgnore(filePath) {
  const parts = filePath.split(path.sep);
  return (
    IGNORE_DIRS.some(dir => parts.includes(dir)) || IGNORE_FILES.some(ext => filePath.endsWith(ext))
  );
}

function checkFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const issues = [];

    lines.forEach((line, index) => {
      TODO_PATTERNS.forEach(pattern => {
        if (pattern.test(line)) {
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
    console.error(`Error reading file ${filePath}:`, error.message);
    return [];
  }
}

function checkDirectory(dir) {
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

// Main execution
const srcDir = path.join(process.cwd(), 'src');

if (!fs.existsSync(srcDir)) {
  console.log('src directory not found, skipping TODO check');
  process.exit(0);
}

const allIssues = checkDirectory(srcDir);

if (allIssues.length > 0) {
  console.warn('\n[WARN] Found TODO/FIXME/XXX/HACK comments in source code:\n');
  allIssues.forEach(issue => {
    console.warn(`  ${issue.file}:${issue.line} - ${issue.type}`);
    console.warn(
      `    ${issue.content.substring(0, 80)}${issue.content.length > 80 ? '...' : ''}\n`
    );
  });
  console.warn(`\nTotal: ${allIssues.length} issue(s) found`);
  console.warn('[WARN] Build continuing. Please address these TODOs when possible.\n');
  process.exit(0); // Don't fail the build - just warn
} else {
  console.log('[OK] No TODO/FIXME/XXX/HACK comments found');
  process.exit(0);
}
