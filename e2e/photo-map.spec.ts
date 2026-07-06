import { expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// Extensionless import: this file is transpiled by Playwright's esbuild, not the
// server's NodeNext tsconfig, so it resolves fixtures.ts directly.
import { makeJpeg } from '../server/tests/helpers/fixtures'

// Istanbul and New York are ~100° of longitude apart — two distinct clusters at world zoom.
test.beforeAll(async ({ request }) => {
  const photoDir = mkdtempSync(join(tmpdir(), 'galleria-e2e-photos-'))
  for (let i = 0; i < 3; i++)
    await makeJpeg(join(photoDir, `ist${i}.jpg`), {
      lat: 41.01 + i * 0.001, lon: 28.98 + i * 0.001, takenAt: `2023:05:0${i + 1} 10:00:00`,
    })
  for (let i = 0; i < 4; i++)
    await makeJpeg(join(photoDir, `nyc${i}.jpg`), {
      lat: 40.71 + i * 0.001, lon: -74.0 + i * 0.001, takenAt: `2024:07:0${i + 1} 10:00:00`,
    })
  for (let i = 0; i < 5; i++)
    await makeJpeg(join(photoDir, `nogps${i}.jpg`), { takenAt: `2024:01:0${i + 1} 10:00:00` })

  const res = await request.post('/api/sources', { data: { path: photoDir } })
  expect(res.status()).toBe(201)
  await expect
    .poll(async () => {
      const status = await (await request.get('/api/scan/status')).json()
      return !status.running && status.lastResult !== null
    }, { timeout: 30_000 })
    .toBe(true)
})

test('shows two clusters at world zoom', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.photo-marker')).toHaveCount(2, { timeout: 15_000 })
})

test('date filter narrows the map', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.photo-marker')).toHaveCount(2, { timeout: 15_000 })
  await page.fill('#date-to', '2023-12-31')
  await expect(page.locator('.photo-marker')).toHaveCount(1)
  await page.fill('#date-to', '2024-12-31')
  await expect(page.locator('.photo-marker')).toHaveCount(2)
})

test('unlocated tray counts GPS-less photos and respects the range', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('unlocated-button')).toContainText('5 photos', { timeout: 15_000 })
  await page.fill('#date-from', '2024-02-01')
  await expect(page.getByTestId('unlocated-button')).toHaveCount(0)
})

test('tray photos open in the lightbox', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('unlocated-button').click()
  await page.locator('[data-testid="tray-panel"] img').first().click()
  await expect(page.getByTestId('lightbox')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('lightbox')).toHaveCount(0)
})

test('sources can be added, hidden, and removed', async ({ page, request }) => {
  const tokyoDir = mkdtempSync(join(tmpdir(), 'galleria-e2e-tokyo-'))
  for (let i = 0; i < 2; i++)
    await makeJpeg(join(tokyoDir, `tokyo${i}.jpg`), {
      lat: 35.68 + i * 0.001, lon: 139.76 + i * 0.001, takenAt: `2025:03:0${i + 1} 10:00:00`,
    })

  const created = await request.post('/api/sources', { data: { path: tokyoDir } })
  expect(created.status()).toBe(201)
  const { id } = await created.json()
  await expect
    .poll(async () => !(await (await request.get('/api/scan/status')).json()).running, { timeout: 30_000 })
    .toBe(true)

  // Nested folders are rejected (create the subfolder so the check reaches
  // the nesting rule rather than the not-a-directory 400).
  mkdirSync(join(tokyoDir, 'sub'))
  const nested = await request.post('/api/sources', { data: { path: join(tokyoDir, 'sub') } })
  expect(nested.status()).toBe(409)

  await page.goto('/')
  await expect(page.locator('.photo-marker')).toHaveCount(3, { timeout: 15_000 }) // Istanbul + NYC + Tokyo

  const hidden = await request.patch(`/api/sources/${id}`, { data: { enabled: false } })
  expect(hidden.ok()).toBeTruthy()
  await page.goto('/')
  await expect(page.locator('.photo-marker')).toHaveCount(2, { timeout: 15_000 })

  const removed = await request.delete(`/api/sources/${id}`)
  expect(removed.ok()).toBeTruthy()
  await page.goto('/')
  await expect(page.locator('.photo-marker')).toHaveCount(2, { timeout: 15_000 })
})
