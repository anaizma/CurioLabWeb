import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'drizzle.config.ts'],
    extends: [...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['drizzle/**', 'migrations/**', 'node_modules/**'],
  },
)
