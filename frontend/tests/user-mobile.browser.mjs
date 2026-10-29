// Run with PLAYWRIGHT_MODULE pointing to an existing Playwright installation; no dependency changes.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.cameraRequests = 0;
  navigator.mediaDevices.getUserMedia = async () => { window.cameraRequests++; throw new DOMException('카메라 권한이 거부되었습니다.', 'NotAllowedError'); };
});
await page.route('**/api/face/context', route => route.fulfill({ json: {mode:'local',user_label:'시연 사용자',registered:false,ready:true,blockers:[],csrf_token:'test-only'} }));
try {
  for (const width of [360,390,430]) {
    await page.setViewportSize({width,height:844});
    await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:5187/user-preview.html');
    await page.getByRole('heading',{name:'내 돈을 한눈에'}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
    await page.screenshot({path:`/tmp/veriface-user-screens/home-${width}.png`,fullPage:true});
  }
  await page.getByRole('button',{name:'송금하기'}).click();
  await page.getByRole('textbox',{name:'받는 사람'}).fill('친구');
  await page.getByRole('textbox',{name:'받는 계좌'}).fill('1234-5678');
  await page.getByRole('textbox',{name:'보낼 금액'}).fill('2450001');
  await page.getByRole('button',{name:'다음'}).click();
  await page.getByRole('alert').filter({hasText:'잔액보다'}).waitFor();
  await page.getByRole('textbox',{name:'보낼 금액'}).fill('-1');
  await page.getByRole('button',{name:'다음'}).click();
  await page.getByRole('alert').filter({hasText:'정수'}).waitFor();
  await page.getByRole('textbox',{name:'보낼 금액'}).fill('30000');
  await page.screenshot({path:'/tmp/veriface-user-screens/input-430.png',fullPage:true});
  await page.getByRole('button',{name:'다음'}).click();
  await page.getByRole('heading',{name:'송금 정보를 확인해 주세요'}).waitFor();
  await page.screenshot({path:'/tmp/veriface-user-screens/confirm-430.png',fullPage:true});
  await page.getByRole('button',{name:'얼굴로 확인하기'}).click();
  await page.getByRole('button',{name:'얼굴 최초 등록 시작'}).waitFor();
  assert.equal(await page.evaluate(()=>window.cameraRequests),0);
  await page.screenshot({path:'/tmp/veriface-user-screens/capture-430.png',fullPage:true});
  await page.getByRole('button',{name:'얼굴 최초 등록 시작'}).click();
  await page.getByRole('alert').filter({hasText:'권한'}).waitFor();
  assert.equal(await page.evaluate(()=>window.cameraRequests),1);
  assert.equal(await page.getByRole('heading',{name:'송금 완료'}).count(),0);
  await page.getByRole('button',{name:'홈으로 돌아가기'}).click();
  assert.equal(await page.locator('.vf-user__balance').innerText(),'2,450,000원');
  await page.getByText('아직 송금 내역이 없어요').waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: 360/390/430px, no overflow, amount validation, confirm/capture, no automatic camera, denial does not complete');
} finally { await browser.close(); }
