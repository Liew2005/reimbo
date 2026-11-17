// Takes README screenshots of the running LOCAL app (seed it first with scripts/seed-demo.mjs).
// Needs: npm i --no-save puppeteer-core, and Chrome installed. Usage: node scripts/screenshots.mjs
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8787'
const PASSWORD = process.env.APP_PASSWORD ?? 'change-me-locally'
const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = 'docs/screenshots'
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })

async function session(theme, viewport) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport(viewport)
  await page.evaluateOnNewDocument((t) => localStorage.setItem('theme', t), theme)
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await page.waitForSelector('input[type=password]', { timeout: 15000 })
  await page.type('input[type=password]', PASSWORD)
  await page.keyboard.press('Enter')
  await page.waitForSelector('.tabbar, .side', { timeout: 15000 })
  await sleep(900)
  return page
}
const clickText = async (page, sel, text) => {
  const els = await page.$$(sel)
  for (const el of els) if ((await el.evaluate((n) => n.textContent.trim())).startsWith(text)) { await el.click(); return }
  throw new Error(`no ${sel} with text ${text}`)
}
const shot = async (page, name) => { await sleep(1100); await page.screenshot({ path: `${OUT}/${name}.png` }); console.log(name) }

for (const theme of ['light', 'dark']) {
  const page = await session(theme, { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await shot(page, `${theme}-add`)
  await clickText(page, '.tab', 'Expenses'); await shot(page, `${theme}-expenses`)
  await clickText(page, '.seg button', 'Summary'); await shot(page, `${theme}-summary`)
  await clickText(page, '.tab', 'Claims'); await shot(page, `${theme}-claims`)
  await (await page.$('.claimcard')).click(); await shot(page, `${theme}-claim-detail`)
  await page.keyboard.press('Escape')
  await clickText(page, '.tab', 'Service'); await shot(page, `${theme}-service`)
  await page.close()
}

const desk = await session('light', { width: 1280, height: 800, deviceScaleFactor: 1.5 })
await clickText(desk, '.navbtn', 'Expenses'); await shot(desk, 'desktop-expenses')
await browser.close()
