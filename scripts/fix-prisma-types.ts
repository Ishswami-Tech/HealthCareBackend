/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Post-generation script to fix TypeScript type inference errors in generated Prisma files
 * This script adds explicit type annotations to exports that TypeScript can't infer
 */

import * as fs from 'fs';
import * as path from 'path';

// CommonJS __dirname is available in Node.js
declare const __dirname: string;

const generatedDir = path.join(
  __dirname,
  '..',
  'src',
  'libs',
  'infrastructure',
  'database',
  'prisma',
  'generated',
  'client',
  'internal'
);

const filesToFix = ['prismaNamespace.ts', 'prismaNamespaceBrowser.ts'];

function fixTypeAnnotations(filePath: string, fileName: string): void {
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠ File not found: ${filePath}`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf-8');
  let modified = false;

  // Fix DbNull export (handle both with and without semicolon)
  if (content.includes('export const DbNull = runtime.DbNull')) {
    content = content.replace(
      /export const DbNull = runtime\.DbNull(\s|$)/g,
      'export const DbNull: typeof runtime.DbNull = runtime.DbNull$1'
    );
    modified = true;
  }

  // Fix JsonNull export (handle both with and without semicolon)
  if (content.includes('export const JsonNull = runtime.JsonNull')) {
    content = content.replace(
      /export const JsonNull = runtime\.JsonNull(\s|$)/g,
      'export const JsonNull: typeof runtime.JsonNull = runtime.JsonNull$1'
    );
    modified = true;
  }

  // Fix AnyNull export (handle both with and without semicolon)
  if (content.includes('export const AnyNull = runtime.AnyNull')) {
    content = content.replace(
      /export const AnyNull = runtime\.AnyNull(\s|$)/g,
      'export const AnyNull: typeof runtime.AnyNull = runtime.AnyNull$1'
    );
    modified = true;
  }

  // Fix NullableJsonNullValueInput - find the exact pattern with multiline support
  // Only in prismaNamespace.ts, not in browser version
  if (fileName === 'prismaNamespace.ts') {
    const nullablePattern =
      /export const NullableJsonNullValueInput = \{[\s\S]{0,500}?\} as const/g;
    if (content.includes('export const NullableJsonNullValueInput = {')) {
      content = content.replace(
        /export const NullableJsonNullValueInput = \{[\s\S]{0,500}?\} as const/g,
        match => {
          return match.replace(
            /export const NullableJsonNullValueInput =/,
            'export const NullableJsonNullValueInput: { DbNull: typeof runtime.DbNull; JsonNull: typeof runtime.JsonNull } ='
          );
        }
      );
      modified = true;
    }

    // Fix JsonNullValueInput - find the exact pattern with multiline support
    const jsonInputPattern = /export const JsonNullValueInput = \{[\s\S]{0,500}?\} as const/g;
    if (content.includes('export const JsonNullValueInput = {')) {
      content = content.replace(jsonInputPattern, match => {
        return match.replace(
          /export const JsonNullValueInput =/,
          'export const JsonNullValueInput: { JsonNull: typeof runtime.JsonNull } ='
        );
      });
      modified = true;
    }

    // Fix JsonNullValueFilter - find the exact pattern with multiline support
    const jsonFilterPattern = /export const JsonNullValueFilter = \{[\s\S]{0,500}?\} as const/g;
    if (content.includes('export const JsonNullValueFilter = {')) {
      content = content.replace(jsonFilterPattern, match => {
        return match.replace(
          /export const JsonNullValueFilter =/,
          'export const JsonNullValueFilter: { DbNull: typeof runtime.DbNull; JsonNull: typeof runtime.JsonNull; AnyNull: typeof runtime.AnyNull } ='
        );
      });
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`[OK] Fixed TypeScript type annotations in ${fileName}`);
  } else {
    console.log(`[OK] No changes needed in ${fileName}`);
  }
}

// Fix all files
for (const fileToFix of filesToFix) {
  const filePath = path.join(generatedDir, fileToFix);
  fixTypeAnnotations(filePath, fileToFix);
}
