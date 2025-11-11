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

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'dist', 'node_modules'],
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
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Any additional stylistic rules can be added here
    },
  }
);
