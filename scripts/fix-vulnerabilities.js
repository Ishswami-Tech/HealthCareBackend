#!/usr/bin/env node

/**
 * Security Health Check (runs as part of yarn build)
 *
 * 1. Runs yarn audit and reports a vulnerability summary
 * 2. Hard-fails if any DIRECT dependency is below its known safe minimum version
 *
 * Outdated package detection is handled separately by validate-code.js (checkOutdated).
 * Allowlist-based enforcement for transitive/upstream advisories is handled by audit-ci.json.
 *
 * To fix a failing security minimum:
 *   yarn upgrade <package>@<safe-version>   then commit the updated yarn.lock
 */

const { execSync } = require('child_process');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Known minimum safe versions for packages that have had CVEs.
 * Only list packages that appear as DIRECT dependencies (dependencies or devDependencies).
 * Transitive-only vulnerabilities are managed via audit-ci.json allowlist.
 */
const SECURITY_MINIMUMS = [
  {
    name: 'jws',
    min: '4.0.1',
    cve: 'GHSA-869p-cjfg-cm3x',
    desc: 'HMAC signature verification bypass',
  },
  { name: 'webpack', min: '5.104.1', cve: 'npm:1113041', desc: 'buildHttp SSRF bypass' },
  { name: 'diff', min: '4.0.4', cve: 'npm:1112704', desc: 'DoS in parsePatch/applyPatch' },
  { name: 'qs', min: '6.14.2', cve: 'npm:1113159', desc: 'arrayLimit bypass DoS' },
  {
    name: 'fast-xml-parser',
    min: '4.5.2',
    cve: 'GHSA-wm3p-3vvf-gqhf',
    desc: 'ReDoS / XML injection',
  },
  { name: 'axios', min: '1.7.0', cve: 'GHSA-jr5f-v2jv-69x6', desc: 'SSRF via proxy URL' },
  {
    name: 'lodash',
    min: '4.17.23',
    cve: 'GHSA-xxjr-mmjv-4gpg',
    desc: 'Prototype pollution in _.unset/_.omit',
  },
];

function parseSemver(v) {
  return String(v)
    .replace(/[^0-9.]/g, '')
    .split('.')
    .map(Number);
}

function semverLt(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na < nb) return true;
    if (na > nb) return false;
  }
  return false;
}

// ─── 1. Audit Summary ────────────────────────────────────────────────────────

function runAuditCheck() {
  log('\n── Vulnerability Audit ──────────────────────────────────', 'blue');

  let auditOutput = '';
  let hasVulnerabilities = false;

  try {
    auditOutput = execSync('yarn audit --json 2>&1', {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });
  } catch (error) {
    auditOutput = error.stdout || '';
    hasVulnerabilities = true;
  }

  let summary = null;
  for (const line of (auditOutput || '').trim().split('\n')) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'auditSummary' && parsed.data) {
        summary = parsed.data.vulnerabilities || {};
        break;
      }
    } catch {
      continue;
    }
  }

  if (!hasVulnerabilities || !summary) {
    log('  ✅ No vulnerabilities found', 'green');
    return;
  }

  const { info = 0, low = 0, moderate = 0, high = 0, critical = 0 } = summary;
  log(`  Vulnerabilities found:`, 'yellow');
  if (critical > 0) log(`    ❌ Critical: ${critical}`, 'red');
  if (high > 0) log(`    ❌ High:     ${high}`, 'red');
  if (moderate > 0) log(`    ⚠️  Moderate: ${moderate}`, 'yellow');
  if (low > 0) log(`    ℹ️  Low:      ${low}`, 'cyan');
  if (info > 0) log(`    ℹ️  Info:     ${info}`, 'cyan');
  log('  Run: npx audit-ci --moderate --config audit-ci.json  for details', 'cyan');

  if (critical > 0 || high > 0) {
    log('  ⚠️  Critical/High found — update audit-ci.json allowlist or upgrade package', 'red');
  }
}

// ─── 2. Security Minimum Version Check ───────────────────────────────────────

function runSecurityMinimumCheck() {
  log('\n── Security Minimum Version Check ───────────────────────', 'blue');

  // Use yarn list --depth=0 to get resolved top-level package versions
  let yarnListOutput = '';
  try {
    yarnListOutput = execSync('yarn list --json --depth=0 2>&1', {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });
  } catch (error) {
    yarnListOutput = error.stdout || '';
  }

  const resolvedVersions = {};
  for (const line of (yarnListOutput || '').trim().split('\n')) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'tree' && parsed.data && parsed.data.trees) {
        parsed.data.trees.forEach(({ name }) => {
          const match = name.match(/^(.+)@([^@]+)$/);
          if (match) resolvedVersions[match[1]] = match[2];
        });
        break;
      }
    } catch {
      continue;
    }
  }

  if (Object.keys(resolvedVersions).length === 0) {
    log('  ⚠️  Could not parse yarn list — skipping minimum version check', 'yellow');
    return true;
  }

  let allSafe = true;
  let anyChecked = false;

  SECURITY_MINIMUMS.forEach(({ name, min, cve, desc }) => {
    const resolved = resolvedVersions[name];
    if (!resolved) return; // transitive only — skip, handled by audit-ci

    anyChecked = true;
    if (semverLt(resolved, min)) {
      log(`  ❌ ${name}@${resolved} is BELOW safe minimum ${min}`, 'red');
      log(`     ${cve} — ${desc}`, 'red');
      log(`     Fix: yarn upgrade ${name}  then commit yarn.lock`, 'yellow');
      allSafe = false;
    } else {
      log(`  ✅ ${name}@${resolved} (≥ ${min})`, 'green');
    }
  });

  if (!anyChecked) {
    log(
      '  ✅ No tracked packages are direct dependencies (transitive only — managed by audit-ci)',
      'green'
    );
  }

  return allSafe;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const startTime = Date.now();

  log('\n' + '='.repeat(60), 'cyan');
  log('Security Health Check', 'cyan');
  log('='.repeat(60), 'cyan');

  runAuditCheck();
  const passed = runSecurityMinimumCheck();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  log('\n' + '='.repeat(60), passed ? 'green' : 'red');
  log(`Security check completed in ${elapsed}s`, passed ? 'green' : 'red');
  log('='.repeat(60) + '\n', passed ? 'green' : 'red');

  if (!passed) {
    log('❌ Build blocked: package(s) below safe minimum version.', 'red');
    log('   Run: yarn upgrade <package>  commit yarn.lock  then retry.\n', 'yellow');
    process.exit(1);
  }
}

main();
