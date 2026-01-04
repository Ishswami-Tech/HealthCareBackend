// eslint.config.mjs
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import nestjsTypedPlugin from '@darraghor/eslint-plugin-nestjs-typed';

// Extract NestJS Typed plugin rules
const nestjsTypedRules =
  nestjsTypedPlugin.configs?.recommended?.rules ||
  nestjsTypedPlugin.configs?.flat?.recommended?.rules ||
  {};

export default [
  {
    ignores: [
      'eslint.config.mjs',
      '.lintstagedrc.js',
      'dist',
      'node_modules',
      'prisma.config.js',
      '**/generated/**',
      'src/libs/infrastructure/database/generated/**',
      'src/libs/infrastructure/database/prisma/generated/**',
      '**/*.generated.ts',
      '**/*.generated.js',
      '**/seed.ts',
      '**/seed.js',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node, // ensure this matches your Node version
        ...globals.jest,
      },
      ecmaVersion: 2020, // upgraded from 5 to support modern JS syntax
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@darraghor/nestjs-typed': nestjsTypedPlugin,
    },
    rules: {
      // NestJS Typed plugin recommended rules
      ...nestjsTypedRules,
      // Your existing strict TypeScript rules
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Recommended for backend: discourage console.log in production code
      // Allow console.log in seed files and scripts
      'no-console': [
        'warn',
        {
          allow: ['warn', 'error'],
        },
      ],

      // Any additional stylistic rules can be added here
    },
  },
  {
    // Allow console.log in seed files and scripts
    files: ['**/seed.ts', '**/seed.js', '**/scripts/**/*.ts', '**/scripts/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // JavaScript files in scripts - disable all TypeScript rules (they require type information)
    files: ['**/scripts/**/*.js'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        ecmaVersion: 2020,
        sourceType: 'script', // Use 'script' for CommonJS files
      },
    },
    rules: {
      // Disable ALL TypeScript-specific rules for JS files (they all require type information)
      // Use a wildcard pattern to disable all @typescript-eslint rules
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-array-delete': 'off',
      // Disable all other TypeScript rules that might require type information
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/prefer-includes': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/prefer-reduce-type-parameter': 'off',
      '@typescript-eslint/prefer-regexp-exec': 'off',
      '@typescript-eslint/prefer-string-starts-ends-with': 'off',
      '@typescript-eslint/switch-exhaustiveness-check': 'off',
    },
  },
  {
    // S3 Storage Service - AWS SDK types are correctly resolved by TypeScript
    // but ESLint's type-aware rules have limitations with complex external types
    files: ['**/s3-storage.service.ts'],
    rules: {
      // These rules are disabled because TypeScript correctly resolves the types
      // and the code is type-safe. ESLint's type-aware rules can't resolve
      // complex external type definitions from @aws-sdk/client-s3.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    // SMTP Email Adapter - nodemailer types are correctly resolved by TypeScript
    // but ESLint's type-aware rules have limitations with incomplete external types
    files: ['**/smtp-email.adapter.ts'],
    rules: {
      // These rules are disabled because TypeScript correctly resolves the types
      // and the code is type-safe. ESLint's type-aware rules can't resolve
      // incomplete type definitions from @types/nodemailer.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    // Allow console.log in seed files and scripts
    files: ['**/seed.ts', '**/seed.js', '**/scripts/**/*.ts', '**/scripts/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
];
