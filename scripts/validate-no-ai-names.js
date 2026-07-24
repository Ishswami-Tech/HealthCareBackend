const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const bannedTerms = [
  ['c', 'l', 'a', 'u', 'd', 'e'].join(''),
  ['a', 'n', 't', 'h', 'r', 'o', 'p', 'i', 'c'].join(''),
  ['o', 'p', 'e', 'n', 'a', 'i'].join(''),
  ['c', 'h', 'a', 't', 'g', 'p', 't'].join(''),
  ['c', 'o', 'p', 'i', 'l', 'o', 't'].join(''),
  ['g', 'e', 'm', 'i', 'n', 'i'].join(''),
  ['c', 'u', 'r', 's', 'o', 'r'].join(''),
  ['c', 'o', 'd', 'e', 'x'].join(''),
];

function hasBannedText(text) {
  const normalizedText = String(text || '').toLowerCase();
  return bannedTerms.some(term => normalizedText.includes(term));
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function scanCommitMessage(messagePath) {
  const message = fs.readFileSync(messagePath, 'utf8');
  if (hasBannedText(message)) {
    fail('Commit message contains a prohibited AI identifier. Remove the term and try again.');
  }
}

function scanStagedFiles() {
  const output = execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
    { encoding: 'utf8' }
  );

  const stagedFiles = output.split('\0').filter(Boolean);
  const violations = [];

  for (const filePath of stagedFiles) {
    const stagedContent = execFileSync('git', ['show', `:${filePath}`], {
      encoding: 'utf8',
    });

    if (hasBannedText(filePath) || hasBannedText(stagedContent)) {
      violations.push(filePath);
    }
  }

  if (violations.length > 0) {
    fail(
      [
        'Staged changes contain a prohibited AI identifier:',
        ...violations.map(filePath => `- ${filePath}`),
      ].join('\n')
    );
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
  const violations = [];

  for (const filePath of changedFiles) {
    const fileContent = execFileSync('git', ['show', `${toRef}:${filePath}`], {
      encoding: 'utf8',
    });

    if (hasBannedText(filePath) || hasBannedText(fileContent)) {
      violations.push(filePath);
    }
  }

  const commitMessages = execFileSync('git', ['log', '--format=%B', `${fromRef}..${toRef}`], {
    encoding: 'utf8',
  });

  if (hasBannedText(commitMessages)) {
    violations.push(`commit-messages:${fromRef}..${toRef}`);
  }

  if (violations.length > 0) {
    fail(
      [
        'Changes in the selected range contain a prohibited AI identifier:',
        ...violations.map(filePath => `- ${filePath}`),
      ].join('\n')
    );
  }
}

const command = process.argv[2] || '--staged';
const targetPath = process.argv[3];

if (command === '--commit-msg') {
  if (!targetPath) {
    fail('Missing commit message path.');
  }
  scanCommitMessage(targetPath);
} else if (command === '--range') {
  const fromRef = process.argv[3];
  const toRef = process.argv[4];
  if (!fromRef || !toRef) {
    fail('Missing range boundaries.');
  }
  scanRange(fromRef, toRef);
} else {
  scanStagedFiles();
}
