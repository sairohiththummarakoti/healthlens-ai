import {test,expect} from '../../frontend/node_modules/@playwright/test';
test.beforeEach(async({baseURL})=>{test.skip(baseURL!=='http://127.0.0.1:5174','Hosted storage/auth checks');});

test('private API requires identity and rejects cross-origin mutations',async({playwright,page,baseURL})=>{
  const anonymous=await playwright.request.newContext({baseURL});
  expect((await anonymous.get('/api/patients')).status()).toBe(401);
  await anonymous.dispose();
  await page.goto('/');await expect(page.getByRole('button',{name:'Explore Sample Patient',exact:true})).toBeEnabled();
  expect((await page.request.post('/api/analyze/PAT-001',{headers:{Origin:'https://unrelated.example'}})).status()).toBe(403);
});

test('uploaded histories survive reload, analyze after reopening, and reset clears them',async({page},testInfo)=>{
  await page.goto('/');await expect(page.getByRole('button',{name:'Explore Sample Patient',exact:true})).toBeEnabled();
  const response=await page.request.post('/api/upload',{multipart:{file:{name:'persistence.csv',mimeType:'text/csv',buffer:Buffer.from('patient_id,date,measurement,value,unit\nSYNTHETIC-REOPEN,2024-01-01,LDL,100,mg/dL\nSYNTHETIC-REOPEN,2025-01-01,LDL,120,mg/dL\n')}}});
  expect(response.ok()).toBeTruthy();const patient=(await response.json()).patients[0];
  await page.reload();await page.getByRole('button',{name:/Patient explorer/}).click();
  await page.getByRole('radio',{name:new RegExp(patient.id)}).check();await page.getByRole('button',{name:'Analyze history',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your health, over time.'})).toBeVisible();
  await expect(page.locator('.chart-change')).toContainText('+20.0%');
  await expect(page.locator('.agent-overview .stage-title span')).toHaveText(['completed','completed','completed','completed']);
  await page.screenshot({path:testInfo.outputPath('hosted-dashboard.png'),fullPage:true});
  await page.getByRole('button',{name:'Reset workspace data',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Reset workspace data',exact:true}).click();
  await expect(page.getByRole('button',{name:'Explore Sample Patient',exact:true})).toBeEnabled();
  const list=await (await page.request.get('/api/patients')).json();expect(list.patients.map((p:any)=>p.id)).toEqual(['PAT-001','PAT-002','PAT-003']);
});
