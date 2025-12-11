#!/usr/bin/env node

/**
 * Check for forbidden TypeScript/ESLint suppression comments
 * Enforces strict TypeScript rules per @.ai-rules/
 * 
 * Forbidden patterns:
 * - @ts-ignore
 * - @ts-expect-error
 * - eslint-disable
 * - eslint-disable-next-line
 * - eslint-disable-line
 * - TODO (should be tracked separately)
 * - FIXME (should be tracked separately)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

const forbiddenPatterns = [
  { pattern: /@ts-ignore/g, name: '@ts-ignore', reason: 'Type errors must be fixed, not ignored' },
  { pattern: /@ts-expect-error/g, name: '@ts-expect-error', reason: 'Type errors must be fixed, not expected' },
  { pattern: /eslint-disable(?:-next-line|-line)?/g, name: 'eslint-disable', reason: 'ESLint errors must be fixed, not disabled' },
  { pattern: /\/\*\s*eslint-disable/g, name: 'eslint-disable (block)', reason: 'ESLint errors must be fixed, not disabled' },
];

const srcDir = path.join(process.cwd(), 'src');
const issues = [];

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  lines.forEach((line, index) => {
    forbiddenPatterns.forEach(({ pattern, name, reason }) => {
      const matches = line.match(pattern);
      if (matches) {
        const relativePath = path.relative(process.cwd(), filePath);
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
  const files = fs.readdirSync(dir);
  
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      // Skip node_modules, dist, and generated files
      if (!['node_modules', 'dist', 'generated', '.git'].includes(file)) {
        walkDir(filePath);
      }
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      // Skip generated Prisma files
      if (!filePath.includes('prisma/generated')) {
        checkFile(filePath);
      }
    }
  });
}

// Main execution
try {
  log('Checking for forbidden TypeScript/ESLint suppression comments...', 'yellow');
  
  if (!fs.existsSync(srcDir)) {
    log('ERROR: src directory not found', 'red');
    process.exit(1);
  }
  
  walkDir(srcDir);
  
  if (issues.length > 0) {
    log(`\n❌ Found ${issues.length} forbidden comment(s):\n`, 'red');
    
    issues.forEach((issue) => {
      log(`  ${issue.file}:${issue.line}`, 'red');
      log(`    Pattern: ${issue.pattern}`, 'yellow');
      log(`    Reason: ${issue.reason}`, 'yellow');
      log(`    Code: ${issue.code.substring(0, 80)}${issue.code.length > 80 ? '...' : ''}`, 'yellow');
      log('');
    });
    
    log('Please fix these issues before building:', 'red');
    log('  - Remove @ts-ignore/@ts-expect-error and fix the underlying type errors', 'yellow');
    log('  - Remove eslint-disable comments and fix the linting issues', 'yellow');
    log('  - Follow strict TypeScript rules as per @.ai-rules/coding-standards.md\n', 'yellow');
    
    process.exit(1);
  }
  
  log('✅ No forbidden comments found', 'green');
  process.exit(0);
} catch (error) {
  log(`ERROR: ${error.message}`, 'red');
  process.exit(1);
}

