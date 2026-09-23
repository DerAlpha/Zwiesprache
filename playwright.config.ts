import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: 'retain-on-failure',
    acceptDownloads: true,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Echte Host-Kandidaten statt mDNS-Namen (im Container gibt es kein mDNS).
          args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--allow-loopback-in-peer-connection'],
        },
      },
    },
  ],
  webServer: {
    // Production-Build (mit CSP) testen, nicht den Dev-Server.
    command: `npm run build && npm run build:single && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
