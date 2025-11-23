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
    // Cross-platform directory search
    const isWindows = process.platform === 'win32';
    let findResult;

    if (isWindows) {
      // Use PowerShell for Windows
      const command = `powershell -Command "Get-ChildItem -Path '${pnpmPath}' -Recurse -Directory -Filter '@prisma+client*' | Where-Object { $_.FullName -like '*\\@prisma+client*\\node_modules\\@prisma\\client' } | Select-Object -ExpandProperty FullName"`;
      findResult = execSync(command, { encoding: 'utf-8', cwd: appRoot, shell: true });
    } else {
      // Use find for Unix-like systems
      findResult = execSync(
        `find "${pnpmPath}" -path "*/@prisma+client*/node_modules/@prisma/client" -type d`,
        { encoding: 'utf-8', cwd: appRoot }
      );
    }

    prismaClientDirs.push(...findResult.trim().split('\n').filter(Boolean));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('Could not find Prisma client directories:', errorMessage);
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
          console.log(`[OK] Symlink already exists and is correct: ${symlinkPath}`);
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
    console.log(`[OK] Created symlink: ${symlinkPath} -> ${targetPath}`);
  } catch (error) {
    if (error.code !== 'EEXIST') {
      console.warn(`[WARN] Failed to create symlink in ${clientDir}:`, error.message);
    } else {
      console.log(`[OK] Symlink already exists: ${symlinkPath}`);
      symlinkCount++;
    }
  }
}

if (symlinkCount > 0) {
  console.log(`\n[OK] Fixed Prisma Client path resolution: ${symlinkCount} symlink(s) created`);
} else {
  console.warn('\n[WARN] No Prisma client directories found to fix');
}
