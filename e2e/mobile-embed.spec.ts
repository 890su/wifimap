import { expect, test } from '@playwright/test'

async function fits(page: import('@playwright/test').Page) {
  const box = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1)
  for (const id of ['project-menu', 'tool-client', 'tool-ap']) {
    const loc = page.getByTestId(id)
    await loc.scrollIntoViewIfNeeded()
    const item = await loc.boundingBox()
    expect(item, id).not.toBeNull()
    expect(item!.x).toBeGreaterThanOrEqual(-1)
    expect(item!.x + item!.width).toBeLessThanOrEqual(box.client + 1)
    if (id !== 'project-menu') {
      expect(item!.height).toBeGreaterThanOrEqual(44)
      expect(item!.width).toBeGreaterThanOrEqual(44)
      const clipped = await loc.locator('span').evaluate((node) => node.scrollWidth - node.clientWidth)
      expect(clipped).toBeLessThanOrEqual(1)
    }
  }
}

test('390px phone keeps the project menu and client tool on screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await fits(page)
})

test('360px and 414px widths do not overflow', async ({ page }) => {
  await page.goto('/')
  for (const width of [360, 414]) {
    await page.setViewportSize({ width, height: 800 })
    await fits(page)
  }
})

test('embed frame stays inside a phone iframe and reports its height', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('http://127.0.0.1:43123/embed-host', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body style="margin:0">
        <script src="/embed.js"></script>
        <iframe id="planner" title="Wi-Fi" src="/?embed=1" style="width:358px;height:640px;border:0"></iframe>
      </body></html>`,
    }),
  )
  await page.goto('/embed-host')
  const child = page.frame({ url: /embed=1/ })
  expect(child).toBeTruthy()
  await child!.waitForSelector('[data-testid="project-menu"]')
  const size = await child!.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1)
  const menu = await child!.locator('[data-testid="project-menu"]').boundingBox()
  const client = await child!.locator('[data-testid="tool-client"]').boundingBox()
  expect(menu!.x + menu!.width).toBeLessThanOrEqual(358 + 1)
  expect(client!.x + client!.width).toBeLessThanOrEqual(358 + 1)
  await expect(child!.locator('[data-testid="embed-fullscreen"]')).toBeVisible()
  await page.waitForFunction(() => {
    const frame = document.querySelector('iframe')
    const height = frame ? Number.parseInt(frame.style.height, 10) : 0
    return height >= 600 && height < 1100
  })
  const script = await page.request.get('/embed.js')
  expect(script.ok()).toBeTruthy()
  const source = await script.text()
  expect(source).toContain('wifiplan:height')
  expect(source).toContain('event.origin')
  expect(source).not.toContain('<div id="root">')
})
