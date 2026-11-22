import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:43123',
    trace: 'off',
  },
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:43123',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run build && npx vite preview --host 127.0.0.1 --port 43124 --strictPort',
      url: 'http://127.0.0.1:43124',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'webkit-desktop',
      testMatch: /sample\.spec\.ts/,
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit-mobile',
      testMatch: /sample\.spec\.ts/,
      use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
    },
  ],
})
