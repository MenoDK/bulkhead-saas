/** @type {import('jest').Config} */
const transform = {
  // Type-checking is `pnpm typecheck`'s job; here we only transpile (fast, and decorators still work).
  '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
};

module.exports = {
  testTimeout: 30000,
  projects: [
    {
      displayName: 'unit',
      rootDir: 'src',
      testRegex: '.*\\.spec\\.ts$',
      moduleFileExtensions: ['js', 'json', 'ts'],
      transform,
      testEnvironment: 'node',
    },
    {
      displayName: 'e2e',
      rootDir: 'test',
      testRegex: '.*\\.e2e-spec\\.ts$',
      globalSetup: '<rootDir>/support/global-setup.ts',
      setupFiles: ['<rootDir>/support/env.ts'],
      moduleFileExtensions: ['js', 'json', 'ts'],
      transform,
      testEnvironment: 'node',
    },
  ],
};
