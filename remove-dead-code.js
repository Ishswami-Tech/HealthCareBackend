const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'libs', 'infrastructure', 'logging', 'logging.service.ts');
const lines = fs.readFileSync(filePath, 'utf8').split('\n');

// Remove lines 669-704 (0-indexed: 668-703) - the clearDatabase block
const newLines = [...lines.slice(0, 668), ...lines.slice(704)];

fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
console.log(`Removed ${704 - 668} lines of dead code (clearDatabase block)`);
console.log(`New file has ${newLines.length} lines (was ${lines.length})`);
