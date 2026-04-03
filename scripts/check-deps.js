#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const depcheck = require('depcheck');
const ts = require('typescript');

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

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadTsConfig(filePath) {
  const parsed = ts.readConfigFile(filePath, ts.sys.readFile);
  if (parsed.error) {
    throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'));
  }
  return parsed.config;
}

function normalizeAliasKey(aliasKey) {
  return aliasKey.endsWith('/*') ? aliasKey.slice(0, -2) : aliasKey;
}

function shouldIgnoreMissingDependency(dependencyName, aliasRoots) {
  return aliasRoots.some(
    aliasRoot => dependencyName === aliasRoot || dependencyName.startsWith(`${aliasRoot}/`)
  );
}

async function main() {
  const appRoot = process.cwd();
  const packageJson = loadJson(path.join(appRoot, 'package.json'));
  const tsconfig = loadTsConfig(path.join(appRoot, 'tsconfig.json'));

  const aliasRoots = Object.keys(tsconfig.compilerOptions?.paths ?? {}).map(normalizeAliasKey);

  const ignoredToolingPackages = new Set([
    '@eslint/eslintrc',
    '@swc/cli',
    '@types/express',
    '@types/react',
    '@types/redis-info',
    'cross-env',
    'glob',
    'js-yaml',
    'minimatch',
    'react',
    'react-dom',
    'source-map-support',
    'ts-loader',
    'tsc-alias',
    'webpack',
  ]);

  const options = {
    ignoreDirs: ['dist', 'coverage', 'node_modules', '.git'],
    ignorePatterns: [
      'docs/**',
      'test-scripts/**',
      'devops/**',
      '*.md',
      '*.log',
      '*.svg',
      '*.yml',
      '*.yaml',
    ],
    ignoreMatches: [...aliasRoots, ...aliasRoots.map(aliasRoot => `${aliasRoot}/*`)],
    specials: [
      depcheck.special.bin,
      depcheck.special.eslint,
      depcheck.special.husky,
      depcheck.special.jest,
      depcheck.special.lintStaged,
      depcheck.special.prettier,
      depcheck.special.webpack,
    ],
  };

  log('\n============================================================', 'cyan');
  log('Dependency Check', 'cyan');
  log('============================================================', 'cyan');

  const result = await depcheck(appRoot, options);

  const filteredMissing = Object.fromEntries(
    Object.entries(result.missing).filter(
      ([dependencyName]) => !shouldIgnoreMissingDependency(dependencyName, aliasRoots)
    )
  );

  const filteredDependencies = result.dependencies.filter(
    dependencyName => !ignoredToolingPackages.has(dependencyName)
  );

  const filteredDevDependencies = result.devDependencies.filter(
    dependencyName => !ignoredToolingPackages.has(dependencyName)
  );

  const missingDependencyNames = Object.keys(filteredMissing).sort();
  const unusedDependencies = filteredDependencies.sort();
  const unusedDevDependencies = filteredDevDependencies.sort();

  if (
    missingDependencyNames.length === 0 &&
    unusedDependencies.length === 0 &&
    unusedDevDependencies.length === 0
  ) {
    log('\nOK No actionable dependency issues found.\n', 'green');
    process.exit(0);
  }

  if (unusedDependencies.length > 0) {
    log('\nUnused dependencies (review before removal):', 'yellow');
    unusedDependencies.forEach(dependencyName => {
      log(`- ${dependencyName}`, 'yellow');
    });
  }

  if (unusedDevDependencies.length > 0) {
    log('\nUnused devDependencies (review before removal):', 'yellow');
    unusedDevDependencies.forEach(dependencyName => {
      log(`- ${dependencyName}`, 'yellow');
    });
  }

  if (missingDependencyNames.length > 0) {
    log('\nMissing dependencies:', 'red');
    missingDependencyNames.forEach(dependencyName => {
      const references = filteredMissing[dependencyName] ?? [];
      log(`- ${dependencyName}`, 'red');
      references.slice(0, 5).forEach(referencePath => {
        log(`  ${referencePath}`, 'red');
      });
      if (references.length > 5) {
        log(`  ... and ${references.length - 5} more`, 'red');
      }
    });
  }

  const ignoredAliases = aliasRoots.length;
  const ignoredTooling = [...ignoredToolingPackages].filter(
    dependencyName =>
      packageJson.dependencies?.[dependencyName] || packageJson.devDependencies?.[dependencyName]
  ).length;

  log('\nInfo:', 'cyan');
  log(`- Ignored ${ignoredAliases} tsconfig alias roots`, 'cyan');
  log(`- Ignored ${ignoredTooling} tooling packages used outside depcheck static analysis`, 'cyan');
  log('', 'reset');

  process.exit(0);
}

main().catch(error => {
  log(
    `\nDependency check failed: ${error instanceof Error ? error.message : String(error)}\n`,
    'red'
  );
  process.exit(1);
});
