import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PW_CHROMIUM_PATH;
// Another port lets parallel checkouts run their own preview server.
const port = process.env.PW_PORT ?? '4173';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${port}/asana-progression/`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-iphone-size',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        hasTouch: true,
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/asana-progression/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
