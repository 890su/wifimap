import { expect, test, type Page } from '@playwright/test'

const SAMPLE_NAME = /Пример квартиры|Sample flat/
const CARD_NAME = /Открыть пример квартиры|Open a sample flat/

async function expectApartment(page: Page) {
  await expect.poll(async () => Number(await page.getByTestId('status-walls').innerText())).toBeGreaterThan(0)
  await expect.poll(async () => Number(await page.getByTestId('status-aps').innerText())).toBeGreaterThan(0)
}

async function seedSavedProject(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('project-menu')).toBeVisible()
  await page.evaluate(async () => {
    const project = {
      version: 1,
      id: 'old-project',
      name: 'Старый план',
      updatedAt: Date.now(),
      world: { width: 800, height: 600 },
      floorPlan: null,
      scale: null,
      walls: [],
      aps: [],
      clients: [],
      isp: { downMbps: 10, upMbps: 10, pingMs: 8 },
      propagation: { exponent: 2.8, autoClutter: false, noiseExtraDb: 3 },
    }
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('wifiplan', 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('projects')) request.result.createObjectStore('projects')
      }
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('projects', 'readwrite')
        tx.objectStore('projects').put(project, project.id)
        tx.oncomplete = () => {
          localStorage.setItem('wifiplan:last', project.id)
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      request.onerror = () => reject(request.error)
    })
  })
  await page.reload()
  await expect(page.locator('.name-input')).toHaveValue('Старый план')
}

test('opens the sample apartment from the empty plan', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: CARD_NAME }).click()
  await expectApartment(page)
  await expect(page.locator('.name-input')).toHaveValue(SAMPLE_NAME)
})

test('opens the sample apartment when a project is already stored', async ({ page }) => {
  await seedSavedProject(page)
  const header = page.locator('.header [data-testid="open-sample"]')
  if (await header.isVisible()) await header.click()
  else {
    await page.getByTestId('project-menu').click()
    await page.locator('.menu-pop [data-testid="open-sample"]').click()
  }
  await expectApartment(page)
  await expect(page.locator('.name-input')).toHaveValue(SAMPLE_NAME)
  await page.reload()
  await expectApartment(page)
  await expect(page.locator('.name-input')).toHaveValue(SAMPLE_NAME)
})

test('a saved project that loads late does not replace the sample', async ({ page }) => {
  await seedSavedProject(page)
  await page.addInitScript(() => {
    const desc = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')
    if (!desc?.set || !desc.get) return
    Object.defineProperty(IDBRequest.prototype, 'onsuccess', {
      configurable: true,
      get() {
        return desc.get?.call(this)
      },
      set(fn: ((this: IDBRequest, event: Event) => void) | null) {
        if (!fn) {
          desc.set?.call(this, fn)
          return
        }
        desc.set?.call(this, function (this: IDBRequest, event: Event) {
          setTimeout(() => fn.call(this, event), 800)
        })
      },
    })
  })
  await page.reload()
  await page.getByRole('button', { name: CARD_NAME }).click()
  await expectApartment(page)
  await page.waitForTimeout(1200)
  await expect(page.locator('.name-input')).toHaveValue(SAMPLE_NAME)
  await expectApartment(page)
})

test('opens the sample apartment while a service worker is in control', async ({ page }) => {
  await page.goto('http://127.0.0.1:43124/')
  await expect(page.getByTestId('project-menu')).toBeVisible()
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  await page.evaluate(async () => {
    const project = {
      version: 1,
      id: 'sw-old-project',
      name: 'Старый план',
      updatedAt: Date.now(),
      world: { width: 800, height: 600 },
      floorPlan: null,
      scale: null,
      walls: [],
      aps: [],
      clients: [],
      isp: { downMbps: 10, upMbps: 10, pingMs: 8 },
      propagation: { exponent: 2.8, autoClutter: false, noiseExtraDb: 3 },
    }
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('wifiplan', 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('projects')) request.result.createObjectStore('projects')
      }
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('projects', 'readwrite')
        tx.objectStore('projects').put(project, project.id)
        tx.oncomplete = () => {
          localStorage.setItem('wifiplan:last', project.id)
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      request.onerror = () => reject(request.error)
    })
  })
  await page.reload()
  await expect(page.locator('.name-input')).toHaveValue('Старый план')
  const header = page.locator('.header [data-testid="open-sample"]')
  if (await header.isVisible()) await header.click()
  else {
    await page.getByTestId('project-menu').click()
    await page.locator('.menu-pop [data-testid="open-sample"]').click()
  }
  await expectApartment(page)
  await page.reload()
  await expectApartment(page)
})
