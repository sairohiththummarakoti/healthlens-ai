import { test, expect } from '../../frontend/node_modules/@playwright/test';

async function openAnalysis(page: import('../../frontend/node_modules/@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore Sample Patient', exact: true }).click();
  await page.getByRole('radio', { name: /PAT-001/ }).check();
  await page.getByRole('button', { name: 'Analyze history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your health, over time.' })).toBeVisible();
}

test('PAT-001 shows original LDL evidence and grounded follow-up', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openAnalysis(page);
  await expect(page.getByRole('img', { name: /LDL values:.*105 mg\/dL.*118 mg\/dL.*132 mg\/dL/ })).toBeVisible();
  await expect(page.locator('.chart-change')).toContainText('+25.7%');
  await page.getByRole('button', { name: 'View source evidence' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Verified against original records');
  await expect(dialog.locator('tbody tr')).toHaveCount(3);
  await expect(dialog.locator('tbody')).toContainText('105');
  await expect(dialog.locator('tbody')).toContainText('118');
  await expect(dialog.locator('tbody')).toContainText('132');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'What changed the most?', exact: true }).click();
  await expect(page.locator('.answer-bubble')).toHaveCount(1);
  const firstEvidence = await page.locator('.chat-evidence button').first().innerText();
  await page.getByLabel('Ask a question about these records').fill('Show me why you said that.');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.locator('.answer-bubble')).toHaveCount(2);
  await expect(page.locator('.chat-entry').last().locator('.chat-evidence button').first()).toHaveText(firstEvidence);
  await page.locator('.chat-entry').last().locator('.chat-evidence button').first().click();
  await expect(page.getByRole('dialog')).toContainText('Verified against original records');
  await page.keyboard.press('Escape');
  await page.getByLabel('Ask a question about these records').fill('Should I stop taking medication?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.locator('.answer-bubble').last()).toContainText('cannot diagnose');
  await expect(page.locator('.page-footer')).toContainText('does not provide medical diagnosis');
  expect(errors).toEqual([]);
});

test('CSV and JSON uploads validate and become analyzable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Upload records', exact: true }).click();
  await page.getByLabel('Choose records file').setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('bad,headers\nno,values') });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Upload and validate' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('CSV requires');
  const records = [
    {patient_id:'BROWSER-DEMO',date:'2024-01-01',measurement:'LDL',value:105,unit:'mg/dL'},
    {patient_id:'BROWSER-DEMO',date:'2025-01-01',measurement:'LDL',value:118,unit:'mg/dL'},
    {patient_id:'BROWSER-DEMO',date:'2026-01-01',measurement:'LDL',value:132,unit:'mg/dL'},
  ];
  await page.getByLabel('Choose records file').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(records)) });
  await page.getByRole('button', { name: 'Upload and validate' }).click();
  await expect(page.getByRole('heading', {name:'Choose a patient history'})).toBeVisible();
  await expect(page.locator('.patient-option.chosen')).toContainText('3 observations');
  await page.getByRole('button', { name: 'Analyze history', exact: true }).click();
  await expect(page.getByRole('heading', {name:'Your health, over time.'})).toBeVisible();
  await expect(page.locator('.chart-change')).toContainText('+25.7%');
});

test('mobile layout stays within viewport and dialogs remain keyboard usable', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await openAnalysis(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.getByRole('button', { name:'View source evidence' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', {name:'View source evidence'})).toBeFocused();
});

test('delayed chat stays with its original analysis and cannot release a newer request', async ({ page }) => {
  let releaseOld!: () => void;
  let releaseNew!: () => void;
  let oldArrived!: () => void;
  let newArrived!: () => void;
  const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
  const newGate = new Promise<void>(resolve => { releaseNew = resolve; });
  const oldIntercepted = new Promise<void>(resolve => { oldArrived = resolve; });
  const newIntercepted = new Promise<void>(resolve => { newArrived = resolve; });
  let requestCount = 0;
  let oldAnalysisId = '';
  await page.route('**/api/chat', async route => {
    const position = ++requestCount;
    const response = await route.fetch();
    const body = await response.json();
    if (position === 1) {
      oldAnalysisId = route.request().postDataJSON().analysis_id;
      body.answer = 'STALE FIRST PATIENT ANSWER';
      body.evidence = body.evidence.map((entry: object) => ({ ...entry, measurement: 'STALE SOURCE EVIDENCE' }));
      oldArrived();
      await oldGate;
    } else {
      body.answer = 'CURRENT PATIENT ANSWER';
      newArrived();
      await newGate;
    }
    await route.fulfill({ response, json: body });
  });
  try {
    await openAnalysis(page);
    await page.getByRole('button', { name: 'What changed the most?', exact: true }).click();
    await oldIntercepted;
    await page.getByRole('button', { name: /Patient explorer/ }).click();
    await page.getByRole('radio', { name: /PAT-002/ }).check();
    await page.getByRole('button', { name: 'Analyze history', exact: true }).click();
    await expect(page.locator('.patient-switcher')).toContainText('PAT-002');
    const prompt = page.getByRole('button', { name: 'What changed the most?', exact: true });
    await expect(prompt).toBeEnabled();
    await prompt.click();
    await newIntercepted;
    await expect(page.locator('.chat-loading')).toBeVisible();
    const oldFinished = page.waitForEvent('requestfinished', request => request.url().endsWith('/api/chat') && request.postDataJSON().analysis_id === oldAnalysisId);
    releaseOld();
    await oldFinished;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    await expect(page.locator('.answer-bubble')).toHaveCount(0);
    await expect(page.getByText('STALE FIRST PATIENT ANSWER')).toHaveCount(0);
    await expect(page.getByText('STALE SOURCE EVIDENCE')).toHaveCount(0);
    await expect(prompt).toBeDisabled();
    await expect(page.locator('.chat-loading')).toBeVisible();
    releaseNew();
    await expect(page.locator('.answer-bubble')).toHaveCount(1);
    await expect(page.locator('.answer-bubble')).toContainText('CURRENT PATIENT ANSWER');
    await expect(prompt).toBeEnabled();
    await expect(page.getByText('STALE FIRST PATIENT ANSWER')).toHaveCount(0);
  } finally {
    releaseOld();
    releaseNew();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('polling failure offers a working analysis retry', async ({ page }) => {
  let firstPoll = true;
  let analysisRequests = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/api/analyze/PAT-001')) analysisRequests += 1;
  });
  await page.route('**/api/analysis/*', async route => {
    if (firstPoll) {
      firstPoll = false;
      await route.fulfill({ status: 503, json: { detail: 'Temporary analysis polling interruption' } });
    } else await route.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore Sample Patient', exact: true }).click();
  await page.getByRole('radio', { name: /PAT-001/ }).check();
  await page.getByRole('button', { name: 'Analyze history', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Temporary analysis polling interruption');
  await expect(page.getByRole('heading', { name: /try that again/ })).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your health, over time.' })).toBeVisible();
  await expect(page.locator('.chart-change')).toContainText('+25.7%');
  expect(analysisRequests).toBe(2);
});
