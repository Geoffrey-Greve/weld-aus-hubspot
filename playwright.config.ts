import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/a11y',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    // Capture on failure for debugging
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      // The axe/structure suites are written against desktop layout (e.g. the
      // 44x44 touch-target sweep in interactions.spec.ts), so keep them here
      // and keep the mobile-only overflow suite out.
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /overflow\.spec\.ts/,
    },
    {
      // Mobile-width horizontal-overflow guard. Runs only overflow.spec.ts.
      //
      // Deliberately Desktop Chrome at a 375px viewport rather than a mobile
      // device descriptor: mobile descriptors enable overlay scrollbars, which
      // would mask exactly the 100vw-vs-content-width class of bug this project
      // exists to catch. A classic scrollbar keeps documentElement.clientWidth
      // an honest content width.
      name: 'mobile-chrome',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
      testMatch: /overflow\.spec\.ts/,
    },
  ],

  // Start the Vite dev server before running tests
  webServer: {
    command: 'pnpm dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
