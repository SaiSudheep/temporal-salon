import { chromium } from '@playwright/test';
import { Client, Connection } from '@temporalio/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const output = path.resolve('presentation/scenario');
mkdirSync(output, { recursive: true });
const connection = await Connection.connect({ address: 'localhost:7233' });
const client = new Client({ connection });
const origin = Date.now();
const workflowId = `juniper-presentation-${origin}`;
const requests = ['Maya Chen', 'Olivia Brooks', 'Nora Patel'].map((name, index) => ({
  id: `presentation-${index}`, clientId: `202555012${index}`, name, mobile: `202555012${index}`,
  service: 'Haircut', stylist: 'Jessica', durationMinutes: 45,
  availableFrom: origin - 3600_000, availableUntil: origin + 86_400_000,
  joinedAt: origin - (3-index) * 1000, status: 'waiting', existingAppointment: '',
}));
const handle = await client.workflow.start('salonWorkflow', {
  workflowId, taskQueue: 'juniper-salon', args: [{ requests, openings: [] }],
});
let browser;
try {
  await handle.executeUpdate('changeSalon', { args: [{ type: 'addOpening', opening: {
    id: 'presentation-opening', service: 'Haircut', stylist: 'Jessica', startsAt: origin + 3600_000,
    durationMinutes: 45, createdAt: origin, offerSeconds: 20, demo: true, reservedInSquare: true,
    status: 'waiting', squareUpdated: false, offers: [], history: [],
  } }] });
  const first = await handle.query('getSalon');
  const firstAt = Date.now();
  const maya = first.openings[0].offers[0];
  if (maya.clientName !== 'Maya Chen') throw new Error('Expected Maya first.');
  let second;
  const limit = Date.now() + 35_000;
  while (Date.now() < limit) {
    second = await handle.query('getSalon');
    if (second.openings[0].offers[1]?.status === 'pending') break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const secondAt = Date.now();
  const olivia = second.openings[0].offers[1];
  if (maya.token === olivia?.token || olivia?.clientName !== 'Olivia Brooks' || second.openings[0].offers[0].status !== 'expired')
    throw new Error('Automatic timeout did not hand the offer to Olivia.');
  const decisions = await Promise.all([
    handle.executeUpdate('changeSalon', { args: [{ type: 'respond', token: maya.token, response: 'accept' }] }),
    handle.executeUpdate('changeSalon', { args: [{ type: 'respond', token: olivia.token, response: 'accept' }] }),
  ]);
  if (decisions[0].ok || !decisions[1].ok) throw new Error('Stale/current acceptance check failed.');
  const accepted = await handle.query('getSalon');
  const acceptedAt = Date.now();
  if (accepted.openings[0].offers.filter(f => f.status === 'accepted').length !== 1) throw new Error('Expected exactly one accepted client.');
  writeFileSync(path.join(output, 'workflow-trace.json'), JSON.stringify({ workflowId, origin, firstAt, secondAt, acceptedAt, first, second, accepted, decisions }, null, 2));

  // The screens use real workflow outcomes with a clearly illustrative afternoon
  // clock, so the presentation is independent of the late-night capture session.
  // No application files, production data, or business outcomes are changed.
  const displayOrigin = Date.parse('2026-10-06T14:00:00-07:00');
  const shift = value => displayOrigin + value - origin;
  function displayState(source, at) {
    const state = structuredClone(source);
    for (const r of state.requests) {
      for (const key of ['availableFrom','availableUntil','joinedAt']) r[key] = shift(r[key]);
    }
    for (const o of state.openings) {
      o.startsAt = displayOrigin + 3600_000; o.createdAt = shift(o.createdAt);
      for (const f of o.offers) for (const key of ['createdAt','expiresAt','respondedAt']) if(f[key]) f[key] = shift(f[key]);
      for (const h of o.history) h.at = shift(h.at);
      o.candidates = state.requests.filter(r => r.status === 'waiting' && !o.offers.some(f => f.requestId === r.id))
        .map(r => ({ id: r.id, name: r.name, busy: false }));
    }
    return { ...state, serverNow: shift(at), timeZone: 'America/Los_Angeles' };
  }
  browser = await chromium.launch();
  async function captureStage(source, at, name) {
    const snapshot = displayState(source, at);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.clock.setFixedTime(new Date(snapshot.serverNow));
    await page.route('**/api/salon', route => route.fulfill({ json: snapshot }));
    await page.goto('http://localhost:3000/', { waitUntil: 'load' });
    await page.locator('.offer-highlight').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.offer-highlight').screenshot({ path: path.join(output, `${name}-offer.png`) });
    await page.locator('.detail-section').filter({ has: page.getByRole('heading', { name: /The story so far/ }) }).screenshot({ path: path.join(output, `${name}-history.png`) });
    if (name === 'maya' || name === 'olivia')
      await page.locator('.detail-section').filter({ has: page.getByRole('heading', { name: /Next in line/ }) }).screenshot({ path: path.join(output, `${name}-queue.png`) });
    if (name === 'accepted') await page.locator('.square-card').screenshot({ path: path.join(output, 'square-pending.png') });
    await page.close();
    return snapshot;
  }
  await captureStage(first, firstAt, 'maya');
  await captureStage(second, secondAt, 'olivia');
  const snapshot = await captureStage(accepted, acceptedAt, 'accepted');
  for (const [name, token] of [['expired', maya.token], ['confirmed', olivia.token]]) {
    const o = snapshot.openings[0], f = o.offers.find(f => f.token === token);
    const page = await browser.newPage({ viewport: { width: 440, height: 950 } });
    await page.clock.setFixedTime(new Date(snapshot.serverNow));
    await page.route('**/api/offers/*', route => route.fulfill({ json: {
      clientName:f.clientName, service:o.service, stylist:o.stylist, startsAt:o.startsAt,
      durationMinutes:45, expiresAt:f.expiresAt, status:f.status, squareUpdated:false, demo:true,
      serverNow:snapshot.serverNow, timeZone:'America/Los_Angeles',
    } }));
    await page.goto(`http://localhost:3000/offer.html?token=${token}`, { waitUntil:'load' });
    await page.locator('.client-icon').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#client-content').screenshot({ path:path.join(output, `client-${name}.png`) });
    await page.close();
  }
  writeFileSync(path.join(output,'capture-notes.txt'), 'Sample screenshots rendered with the unmodified prototype UI.\nThe underlying states came from a real isolated Temporal workflow: Maya timed out, Olivia received the next offer, Maya\'s stale acceptance was rejected, and Olivia accepted.\nAppointment and history display times were rebased to an illustrative 3 pm appointment on October 6; screenshots are explicitly labeled as a sample scenario.\nThe 20-second demo window is real; standard offers are up to 15 minutes.\n');
  console.log('Captured Maya → real timeout → Olivia → acceptance; stale acceptance rejected.');
} finally {
  if (browser) await browser.close();
  await handle.terminate('Presentation scenario captured');
  await connection.close();
}
