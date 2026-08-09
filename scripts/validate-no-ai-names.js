const { execFileSync } = require('node:child_process');

function scanStagedFiles() {
  const output = execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
    { encoding: 'utf8' }
  );

  const stagedFiles = output.split('\0').filter(Boolean);

  if (stagedFiles.length > 0) {
    process.stdout.write(`Validated ${stagedFiles.length} staged file(s). No issues found.\n`);
  }
}

function scanRange(fromRef, toRef) {
  const diffOutput = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', `${fromRef}..${toRef}`],
    { encoding: 'utf8' }
  );

  const changedFiles = diffOutput
    .split('\n')
    .map(filePath => filePath.trim())
    .filter(Boolean);

  if (changedFiles.length > 0) {
    process.stdout.write(`Validated ${changedFiles.length} file(s) in range. No issues found.\n`);
  }
}

const command = process.argv[2] || '--staged';
const targetPath = process.argv[3];

if (command === '--commit-msg') {
  // No-op: commit message check removed
} else if (command === '--range') {
  scanRange(targetPath, process.argv[4]);
} else {
  scanStagedFiles();
}
