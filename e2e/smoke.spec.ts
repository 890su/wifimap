import { expect, test } from '@playwright/test'
import path from 'node:path'

const plan = path.join(import.meta.dirname, 'fixtures', 'plan.png')

test('loads a plan, scales it, draws a wall, and shows coverage', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('plan-file').setInputFiles(plan)
  await expect(page.getByTestId('plan-loaded')).toHaveText('yes')

  await page.getByTestId('tool-scale').click()
  const stage = page.getByTestId('stage')
  await stage.click({ position: { x: 80, y: 140 } })
  await stage.click({ position: { x: 280, y: 140 } })
  await expect(page.getByTestId('scale-dialog')).toBeVisible()
  await page.getByTestId('scale-length').fill('4')
  await page.getByTestId('scale-confirm').click()
  await expect(page.getByTestId('status-scale')).toHaveAttribute('data-approximate', 'no')

  await page.getByTestId('tool-wall').click()
  await stage.click({ position: { x: 120, y: 90 } })
  await stage.click({ position: { x: 120, y: 280 } })
  await expect(page.getByTestId('status-walls')).toHaveText('1')

  await page.getByTestId('tool-ap').click()
  await stage.click({ position: { x: 200, y: 180 } })
  await expect(page.getByTestId('status-aps')).toHaveText('1')

  await page.getByTestId('tool-client').click()
  await stage.click({ position: { x: 60, y: 180 } })
  await expect(page.getByTestId('status-clients')).toHaveText('1')

  await expect(page.getByTestId('heatmap-status')).toHaveText('ready', { timeout: 15_000 })
  await expect(page.getByTestId('client-results')).toContainText(/Мбит\/с|Mbps/)
  const down = Number(await page.getByTestId('result-down').innerText())
  expect(down).toBeGreaterThan(5)
})
