#!/usr/bin/env node
/**
 * Fix Prisma Client path resolution for pnpm
 * Creates symlink from @prisma/client/.prisma to node_modules/.prisma
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const appRoot = path.resolve(__dirname, '..');
const prismaClientPath = path.join(appRoot, 'node_modules', '.prisma', 'client');

// Find all @prisma/client instances in .pnpm
const pnpmPath = path.join(appRoot, 'node_modules', '.pnpm');
const prismaClientDirs = [];

if (fs.existsSync(pnpmPath)) {
  try {
    const findResult = execSync(
      `find "${pnpmPath}" -path "*/@prisma+client*/node_modules/@prisma/client" -type d`,
      { encoding: 'utf-8', cwd: appRoot }
    );
    prismaClientDirs.push(...findResult.trim().split('\n').filter(Boolean));
  } catch (error) {
    console.warn('Could not find Prisma client directories:', error.message);
  }
}

// Create symlink in each @prisma/client directory
let symlinkCount = 0;
for (const clientDir of prismaClientDirs) {
  const symlinkPath = path.join(clientDir, '.prisma');
  
  try {
    const targetPath = path.join(appRoot, 'node_modules', '.prisma');
    
    // Check if symlink already exists and points to correct location
    if (fs.existsSync(symlinkPath)) {
      try {
        const realPath = fs.realpathSync(symlinkPath);
        if (realPath === targetPath) {
          console.log(`✓ Symlink already exists and is correct: ${symlinkPath}`);
          symlinkCount++;
          continue;
        } else {
          // Remove incorrect symlink
          fs.unlinkSync(symlinkPath);
        }
      } catch (error) {
        // Not a symlink or broken, remove it
        fs.unlinkSync(symlinkPath);
      }
    }
    
    // Create symlink to node_modules/.prisma using absolute path
    // Use absolute path to ensure symlink works correctly with TypeScript resolution
    const absoluteTargetPath = path.resolve(appRoot, 'node_modules', '.prisma');
    fs.symlinkSync(absoluteTargetPath, symlinkPath, 'dir');
    symlinkCount++;
    console.log(`✓ Created symlink: ${symlinkPath} -> ${targetPath}`);
  } catch (error) {
    if (error.code !== 'EEXIST') {
      console.warn(`⚠ Failed to create symlink in ${clientDir}:`, error.message);
    } else {
      console.log(`✓ Symlink already exists: ${symlinkPath}`);
      symlinkCount++;
    }
  }
}

if (symlinkCount > 0) {
  console.log(`\n✓ Fixed Prisma Client path resolution: ${symlinkCount} symlink(s) created`);
} else {
  console.warn('\n⚠ No Prisma client directories found to fix');
}

