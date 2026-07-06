import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:3000' },
  webServer: {
    command:
      'rm -rf .e2e-data && npm run build -w web && GALLERIA_NO_OPEN=1 GALLERIA_DATA_DIR=.e2e-data PORT=3000 tsx server/src/index.ts',
    url: 'http://127.0.0.1:3000/health',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
