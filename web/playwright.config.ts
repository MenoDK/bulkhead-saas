import { defineConfig, devices } from '@playwright/test';

/** Black-box browser tests against a RUNNING stack (`make up`), through the same nginx front door a user hits. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  // The accessibility sweep visits twelve screens (six pages, light and dark) and takes about half a minute by design.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    // The phone project covers the console. The landing page, the lab and the languages are checked on the desktop
    // project only; they open their own phone-sized contexts where it matters.
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testIgnore: ['**/landing.e2e.ts', '**/lab.e2e.ts', '**/i18n.e2e.ts', '**/shots.e2e.ts'],
    },
  ],
});
