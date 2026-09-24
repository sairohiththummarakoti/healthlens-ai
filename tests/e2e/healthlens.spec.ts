import { test, expect } from '../../frontend/node_modules/@playwright/test';
import type { Analysis } from '../../frontend/src/types';

const agentNames = ['Patient History Agent', 'Trend Analysis Agent', 'Evidence Verification Agent', 'Self-Explanation Agent'];
const syntheticRecords = (patientId: string, values = [105, 118, 132]) => values.map((value, index) => ({
  patient_id: patientId, date: `${2024 + index}-01-01`, measurement: 'LDL', value, unit: 'mg/dL',
}));

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

test('all four agents are visible before an analysis without claiming execution', async ({ page }) => {
  await page.goto('/');
  for (const name of agentNames) {
    const card = page.locator('.how-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Not run');
  }
  await page.getByRole('button', { name: 'Agent activity', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.stage-title strong')).toHaveText(agentNames);
  await expect(dialog.locator('.stage-title span')).toHaveText(['Not run', 'Not run', 'Not run', 'Not run']);
  await expect(dialog.locator('time')).toHaveCount(0);
  await expect(dialog).toContainText('Deterministic explanation');
});

test('downloaded example CSV goes directly to verified results and real four-agent activity', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Upload records', exact: true }).click();
  const downloadReady = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download example CSV' }).click();
  const download = await downloadReady;
  expect(download.suggestedFilename()).toBe('healthlens-synthetic-sample.csv');
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  const submit = page.getByRole('button', { name: 'Upload and analyze', exact: true });
  await expect(submit).toBeDisabled();
  await page.getByLabel('Choose records file').setInputFiles(path);
  await expect(page.getByRole('dialog')).toContainText(download.suggestedFilename());
  await expect(submit).toBeDisabled();
  await page.getByRole('checkbox').check();
  await expect(submit).toBeEnabled();
  const completedResponse = page.waitForResponse(async response => response.url().match(/\/api\/analysis\/[^/]+$/) !== null
    && response.ok() && (await response.json()).status === 'completed');
  await submit.click();
  await expect(page.getByRole('heading', { name: 'Your health, over time.' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.chart-change')).toContainText('+25.7%');
  await expect(page.getByRole('img', { name: /LDL values:.*105 mg\/dL.*118 mg\/dL.*132 mg\/dL/ })).toBeVisible();
  await expect(page.locator('.context-row')).toContainText('User-supplied synthetic demonstration upload');
  const result: Analysis = await (await completedResponse).json();
  expect(result.stages.map(stage => stage.name)).toEqual(agentNames);
  const activity = page.getByRole('region', { name: 'Four-agent analysis', exact: true });
  await expect(activity).toBeVisible();
  await expect(activity.locator('.stage')).toHaveCount(4);
  for (const [index, stage] of result.stages.entries()) {
    expect(stage.status).toBe('completed');
    expect(stage.started_at).toBeTruthy();
    expect(stage.completed_at).toBeTruthy();
    expect(Date.parse(stage.completed_at!)).toBeGreaterThanOrEqual(Date.parse(stage.started_at!));
    const displayedStage = activity.locator('.stage').nth(index);
    await expect(displayedStage.locator('.stage-title strong')).toHaveText(stage.name);
    await expect(displayedStage.locator('.stage-title span')).toHaveText(/completed/i);
    await expect(displayedStage).toContainText(stage.detail);
    await expect(displayedStage.locator('time')).toHaveAttribute('datetime', stage.completed_at!);
    await expect(displayedStage.locator('time')).toHaveText(/\d{1,2}:\d{2}/);
  }
  await expect(activity).toContainText('no language model was called');
  await page.getByRole('button', { name: 'View source evidence' }).click();
  const evidence = page.getByRole('dialog');
  await expect(evidence).toContainText('Verified against original records');
  await expect(evidence.locator('tbody tr')).toHaveCount(3);
  await expect(evidence.locator('tbody')).toContainText('upload-');
  expect(errors).toEqual([]);
});

test('invalid CSV gives feedback and corrected JSON automatically analyzes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Upload records', exact: true }).click();
  await page.getByLabel('Choose records file').setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('bad,headers\nno,values') });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Upload and analyze', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('CSV requires');
  const records = syntheticRecords('BROWSER-DEMO');
  await page.getByLabel('Choose records file').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(records)) });
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Upload and analyze', exact: true }).click();
  await expect(page.getByRole('heading', {name:'Your health, over time.'})).toBeVisible();
  await expect(page.locator('.chart-change')).toContainText('+25.7%');
});

test('multi-patient upload offers only imported histories and analyzes the chosen one', async ({ page }) => {
  let analysisRequests = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/analyze/')) analysisRequests += 1; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Upload records', exact: true }).click();
  const records = [...syntheticRecords('FIRST-SYNTHETIC', [50, 60, 75]), ...syntheticRecords('SECOND-SYNTHETIC', [200, 180, 160])];
  await page.getByLabel('Choose records file').setInputFiles({ name: 'two-histories.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(records)) });
  await page.getByRole('checkbox').check();
  const uploaded = page.waitForResponse(response => response.url().endsWith('/api/upload') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Upload and analyze', exact: true }).click();
  const imported: { patients: { id: string }[] } = await (await uploaded).json();
  const dialog = page.getByRole('dialog', { name: 'Choose a patient history' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Imported two-histories.json: 6 observations across 2 patient profile(s)');
  await expect(dialog).toContainText('Select an imported patient below, then choose Analyze history');
  await expect(dialog.getByRole('radio')).toHaveCount(2);
  expect(analysisRequests).toBe(0);
  for (const patient of imported.patients) await expect(dialog.getByRole('radio', { name: new RegExp(patient.id) })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /PAT-001/ })).toHaveCount(0);
  await dialog.getByRole('radio', { name: new RegExp(imported.patients[1].id) }).check();
  await dialog.getByRole('button', { name: 'Analyze history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your health, over time.' })).toBeVisible();
  await expect(page.locator('.patient-switcher')).toContainText(imported.patients[1].id);
  await expect(page.locator('.chart-change')).toContainText('-20.0%');
  await expect(page.getByRole('img', { name: /LDL values:.*200 mg\/dL.*180 mg\/dL.*160 mg\/dL/ })).toBeVisible();
  expect(analysisRequests).toBe(1);
});

test('analysis failure after upload retries the imported patient without importing again', async ({ page }) => {
  let uploads = 0;
  let analysisRequests = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/upload')) uploads += 1; });
  await page.route('**/api/analyze/*', async route => {
    analysisRequests += 1;
    if (analysisRequests === 1) await route.fulfill({ status: 503, json: { detail: 'Analysis service temporarily unavailable' } });
    else await route.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Upload records', exact: true }).click();
  await page.getByLabel('Choose records file').setInputFiles({ name: 'retry-analysis.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(syntheticRecords('RETRY-SYNTHETIC'))) });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Upload and analyze', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Analysis service temporarily unavailable');
  await expect(page.getByRole('heading', { name: /try that again/ })).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your health, over time.' })).toBeVisible();
  await expect(page.locator('.chart-change')).toContainText('+25.7%');
  expect(uploads).toBe(1);
  expect(analysisRequests).toBe(2);
});

test('upload service error retains the file and consent for a successful retry', async ({ page }) => {
  let uploadRequests = 0;
  await page.route('**/api/upload', async route => {
    uploadRequests += 1;
    if (uploadRequests === 1) await route.fulfill({ status: 503, json: { detail: 'Upload service temporarily unavailable' } });
    else await route.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Upload records', exact: true }).click();
  await page.getByLabel('Choose records file').setInputFiles({ name: 'retry-upload.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(syntheticRecords('RECOVERY-SYNTHETIC'))) });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Upload and analyze', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('Upload service temporarily unavailable');
  await expect(dialog).toContainText('retry-upload.json');
  await expect(dialog.getByRole('checkbox')).toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Upload and analyze', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Upload and analyze', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your health, over time.' })).toBeVisible();
  await expect(page.locator('.chart-change')).toContainText('+25.7%');
  expect(uploadRequests).toBe(2);
});

test('pending upload disables duplicate actions and recovers after a confirmation timeout', async ({ page }) => {
  let releaseUpload!: () => void;
  let uploadArrived!: () => void;
  const heldUpload = new Promise<void>(resolve => { releaseUpload = resolve; });
  const intercepted = new Promise<void>(resolve => { uploadArrived = resolve; });
  let uploadRequests = 0;
  await page.route('**/api/upload', async route => {
    uploadRequests += 1;
    if (uploadRequests === 1) {
      uploadArrived();
      await heldUpload;
      // This request never reaches the backend, so retrying cannot create a duplicate import.
      await route.abort();
    } else await route.continue();
  });
  try {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Explore Sample Patient', exact: true })).toBeEnabled();
    await page.clock.install();
    await page.getByRole('button', { name: 'Upload records', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await page.getByLabel('Choose records file').setInputFiles({ name: 'timeout-recovery.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(syntheticRecords('TIMEOUT-SYNTHETIC'))) });
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Upload and analyze', exact: true }).click();
    await intercepted;
    await expect(dialog.getByRole('status')).toContainText('Validating and saving your records');
    await expect(dialog.locator('form')).toHaveAttribute('aria-busy', 'true');
    await expect(dialog.getByLabel('Choose records file')).toBeDisabled();
    await expect(dialog.getByRole('checkbox')).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Validating records…', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.clock.fastForward(20_001);
    await expect(dialog.getByRole('alert')).toContainText('Upload confirmation timed out');
    await expect(dialog.getByRole('alert')).toContainText('Check Patient explorer for an imported profile before uploading again');
    await expect(dialog.locator('form')).toHaveAttribute('aria-busy', 'false');
    await expect(dialog).toContainText('timeout-recovery.json');
    await expect(dialog.getByRole('checkbox')).toBeChecked();
    await expect(dialog.getByRole('checkbox')).toBeEnabled();
    const retry = dialog.getByRole('button', { name: 'Upload and analyze', exact: true });
    await expect(retry).toBeEnabled();
    expect(uploadRequests).toBe(1);
    releaseUpload();
    await retry.click();
    await expect(page.getByRole('heading', { name: 'Your health, over time.' })).toBeVisible();
    await expect(page.locator('.chart-change')).toContainText('+25.7%');
    expect(uploadRequests).toBe(2);
  } finally {
    releaseUpload();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('lost upload confirmation recovers the saved history without a duplicate import', async ({ page }) => {
  let releaseConfirmation!: () => void;
  let importSaved!: () => void;
  const heldConfirmation = new Promise<void>(resolve => { releaseConfirmation = resolve; });
  const saved = new Promise<void>(resolve => { importSaved = resolve; });
  let importedId = '';
  let uploadRequests = 0;
  await page.route('**/api/upload', async route => {
    uploadRequests += 1;
    const response = await route.fetch();
    const result = await response.json();
    importedId = result.patients[0].id;
    importSaved();
    await heldConfirmation;
    await route.fulfill({ response });
  });
  try {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Explore Sample Patient', exact: true })).toBeEnabled();
    await page.clock.install();
    await page.getByRole('button', { name: 'Upload records', exact: true }).click();
    await page.getByLabel('Choose records file').setInputFiles({ name: 'saved-without-confirmation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(syntheticRecords('LOST-CONFIRMATION'))) });
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Upload and analyze', exact: true }).click();
    await saved;
    expect(importedId).toMatch(/^UP-/);
    await page.clock.fastForward(20_001);
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Upload confirmation timed out');
    const refresh = page.waitForResponse(response => response.url().endsWith('/api/patients') && response.ok());
    await page.getByRole('button', { name: 'Check imported histories', exact: true }).click();
    await refresh;
    const choices = page.getByRole('dialog', { name: 'Choose a patient history' });
    const recovered = choices.getByRole('radio', { name: new RegExp(importedId) });
    await expect(recovered).toBeVisible();
    await recovered.check();
    await choices.getByRole('button', { name: 'Analyze history', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your health, over time.' })).toBeVisible();
    await expect(page.locator('.patient-switcher')).toContainText(importedId);
    await expect(page.locator('.chart-change')).toContainText('+25.7%');
    expect(uploadRequests).toBe(1);
  } finally {
    releaseConfirmation();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('a delayed initial patient list cannot replace newly imported patient choices', async ({ page }) => {
  const originalPatients = await (await page.request.get('/api/patients')).json();
  let releasePatients!: () => void;
  let patientsArrived!: () => void;
  const heldPatients = new Promise<void>(resolve => { releasePatients = resolve; });
  const intercepted = new Promise<void>(resolve => { patientsArrived = resolve; });
  const staleRequests: import('../../frontend/node_modules/@playwright/test').Request[] = [];
  await page.route('**/api/patients', async route => {
    staleRequests.push(route.request());
    patientsArrived();
    await heldPatients;
    await route.fulfill({ json: originalPatients });
  });
  try {
    await page.goto('/');
    await intercepted;
    await page.getByRole('button', { name: 'Upload records', exact: true }).click();
    const records = [...syntheticRecords('RACE-FIRST', [50, 60, 75]), ...syntheticRecords('RACE-SECOND', [200, 180, 160])];
    await page.getByLabel('Choose records file').setInputFiles({ name: 'new-histories.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(records)) });
    await page.getByRole('checkbox').check();
    const uploaded = page.waitForResponse(response => response.url().endsWith('/api/upload') && response.ok());
    await page.getByRole('button', { name: 'Upload and analyze', exact: true }).click();
    const imported: { patients: { id: string }[] } = await (await uploaded).json();
    const choices = page.getByRole('dialog', { name: 'Choose a patient history' });
    await expect(choices.getByRole('radio')).toHaveCount(2);
    await expect(choices.getByRole('button', { name: 'Analyze history', exact: true })).toBeEnabled();
    const finished = Promise.all(staleRequests.map(stale => page.waitForEvent('requestfinished', request => request === stale)));
    releasePatients();
    await finished;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    await expect(choices.getByRole('radio')).toHaveCount(2);
    for (const patient of imported.patients) await expect(choices.getByRole('radio', { name: new RegExp(patient.id) })).toBeVisible();
    await choices.getByRole('radio', { name: new RegExp(imported.patients[1].id) }).check();
    await choices.getByRole('button', { name: 'Analyze history', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your health, over time.' })).toBeVisible();
    await expect(page.locator('.patient-switcher')).toContainText(imported.patients[1].id);
    await expect(page.locator('.chart-change')).toContainText('-20.0%');
  } finally {
    releasePatients();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('mobile layout stays within viewport and dialogs remain keyboard usable', async ({ page }) => {
  await page.setViewportSize({width:375,height:812});
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Explore Sample Patient', exact: true })).toBeEnabled();
  const upload = page.getByRole('button', { name: 'Upload records', exact: true });
  await upload.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(upload).toBeFocused();
  await openAnalysis(page);
  await expect(page.getByRole('region', { name: 'Four-agent analysis', exact: true })).toBeVisible();
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
