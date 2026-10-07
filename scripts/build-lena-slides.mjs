import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const folder = path.resolve('presentation');
mkdirSync(path.join(folder, 'individual-slides'), { recursive: true });
mkdirSync(path.join(folder, 'previews'), { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(folder, 'juniper-for-lena.html')).href, { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);
  const slides = page.locator('.slide');
  const count = await slides.count();
  if (count !== 5) throw new Error(`Expected 5 slides, found ${count}`);
  const dimensions = await slides.evaluateAll(elements => elements.map(el => ({
    width: el.clientWidth, height: el.clientHeight, scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight,
    footerTop: el.querySelector('.footer').getBoundingClientRect().top - el.getBoundingClientRect().top,
    contentBottom: Math.max(...Array.from(el.children).filter(child => !child.classList.contains('footer')).map(child => child.getBoundingClientRect().bottom - el.getBoundingClientRect().top)),
  })));
  for (const [i, bounds] of dimensions.entries()) {
    if (bounds.scrollWidth > bounds.width || bounds.scrollHeight > bounds.height || bounds.contentBottom > bounds.footerTop - 8)
      throw new Error(`Slide ${i + 1} overflows or overlaps footer: ${JSON.stringify(bounds)}`);
    await slides.nth(i).screenshot({ path: path.join(folder, 'previews', `slide-${i + 1}.png`) });
  }
  const options = { printBackground: true, preferCSSPageSize: true, tagged: true, displayHeaderFooter: false };
  const pdf = await page.pdf({ ...options, path: path.join(folder, 'Juniper-Salon-Lena-Review.pdf') });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  if (pages !== 5) throw new Error(`PDF contains ${pages} pages instead of 5`);
  const names = ['01-the-opening', '02-mayas-offer', '03-automatic-handoff', '04-olivias-acceptance', '05-next-step'];
  for (let i = 0; i < count; i++) {
    await page.pdf({ ...options, pageRanges: String(i + 1), path: path.join(folder, 'individual-slides', `${names[i]}.pdf`) });
  }
  writeFileSync(path.join(folder, 'previews', 'validation.json'), JSON.stringify({ pages, dimensions }, null, 2));
  console.log(`Created ${pages}-page PDF and five standalone slide PDFs; no overflow or footer overlap.`);
} finally { await browser.close(); }
