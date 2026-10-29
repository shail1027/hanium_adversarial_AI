// The real App entry, with explicit login/face-context and dataset-error doubles.
// No camera, face inference, account authentication, or FULL approval is exercised.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' });
const url = process.env.PREVIEW_URL || 'http://127.0.0.1:5173/';
const output = process.env.APP_SCREENSHOTS || '/tmp/veriface-final-web-screens';
await mkdir(output, { recursive: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
const adminRequests = [];
let failDatasets = true;
let loginRequests = 0;
let failLogin = false;
let holdLogin = false;
let releaseLogin;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (/\/(forensics|defense|hc160)\//.test(new URL(request.url()).pathname)) adminRequests.push(request.url());
});
await page.addInitScript(() => {
  window.cameraRequests = 0;
  navigator.mediaDevices.getUserMedia = async () => { window.cameraRequests++; throw new Error('Camera forbidden in integration check'); };
});
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/auth/login') {
    loginRequests++;
    if (failLogin) return route.fulfill({ status: 503, json: { detail: 'Explicit login failure' } });
    if (holdLogin) await new Promise(resolve => { releaseLogin = resolve; });
    const role = route.request().postDataJSON().username === 'admin' ? 'admin' : 'user';
    return route.fulfill({ json: { access_token: '', token_type: 'demo', role, display_name: role === 'admin' ? '관리자' : '사용자' } });
  }
  if (path === '/api/face/context') return route.fulfill({ json: { mode: 'local', user_label: '사용자', ready: true, registered: false, blockers: [], csrf_token: 'app-test-only' } });
  return route.fulfill({ status: 503, body: 'Explicit API fallback test' });
});
await page.route(/\/(forensics|defense|hc160)\//, route => failDatasets ? route.fulfill({ status: 503, body: 'Dataset unavailable test' }) : route.continue());
async function signIn(role) {
  await page.getByRole('button', { name: role === 'admin' ? '관리자' : '사용자', exact: true }).click();
  assert.equal(await page.getByLabel('아이디', { exact: true }).inputValue(), role);
  await page.locator('form button[type="submit"]').click();
}
async function userLogout() {
  await page.getByRole('button', { name: '내 정보 보기', exact: true }).click();
  await page.getByRole('button', { name: '나가기', exact: true }).click();
  await page.getByRole('heading', { name: '얼굴 인증', exact: true }).waitFor();
}
const menu = name => page.getByRole('navigation', { name: '관리자 메뉴' }).getByRole('button', { name, exact: true });
const noOverflow = async label => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, label);
try {
  await page.goto(url);
  failLogin = true;
  await signIn('user');
  await page.getByRole('alert').waitFor();
  assert.equal(await page.locator('.vf-user, .veriface-admin').count(), 0);
  failLogin = false; loginRequests = 0;
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(url);
    await noOverflow(`login ${width}`);
    await page.screenshot({ path: `${output}/login-${width}.png`, fullPage: true });
    if (width === 360) {
      holdLogin = true;
      await page.locator('form').evaluate(form => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      for (let attempt = 0; !releaseLogin && attempt < 50; attempt++) await page.waitForTimeout(20);
      await page.waitForTimeout(100);
      assert.equal(loginRequests, 1, 'synchronous duplicate submits issue only one request');
      releaseLogin(); holdLogin = false;
    } else await signIn('user');
    await page.getByRole('heading', { name: '내 돈을 한눈에', exact: true }).waitFor();
    await noOverflow(`user ${width}`);
    assert.equal(await page.locator('h1').evaluate(el => getComputedStyle(el).color), 'rgb(244, 241, 250)');
    assert.equal(await page.locator('.veriface-admin').count(), 0);
    await page.screenshot({ path: `${output}/user-${width}.png`, fullPage: true });
    await userLogout();
  }
  assert.deepEqual(adminRequests, [], 'user/login do not request any administrator datasets, even when they fail');
  await signIn('admin');
  await page.locator('.veriface-admin').waitFor();
  await page.getByRole('alert').filter({ hasText: '데이터를 불러오지 못했습니다.' }).first().waitFor();
  await page.getByRole('button', { name: '로그아웃', exact: false }).click();
  await signIn('user');
  await page.getByRole('heading', { name: '내 돈을 한눈에' }).waitFor();
  await userLogout();
  failDatasets = false;
  await signIn('admin');
  await page.getByRole('heading', { name: '공격별 결과', exact: true }).waitFor();
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await noOverflow(`admin ${width}`);
    assert.equal(await page.locator('h1').evaluate(el => getComputedStyle(el).color), 'rgb(244, 241, 250)');
    await page.screenshot({ path: `${output}/admin-${width}.png`, animations: 'disabled' });
  }
  for (const name of ['인증 결과', '공격 분석', '방어 분석', '실험 기록', '개요']) {
    await menu(name).click();
    await noOverflow(name);
    assert.equal(await page.locator('.admin-page:not([hidden])').count(), 1);
  }
  await menu('공격 분석').click();
  const tipButton = page.getByRole('button', { name: 'pgd 수치와 분모 보기', exact: true });
  await tipButton.focus();
  await page.getByRole('tooltip').waitFor();
  const bounds = await page.getByRole('tooltip').boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1440);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[popover]:popover-open').count(), 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await menu('개요').click();
  assert.equal(await page.locator('.admin-page:not([hidden])').evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  await menu('공격 분석').click();
  await noOverflow('admin mobile');
  await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  await menu('개요').focus();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: '메뉴 열기', exact: true }).getAttribute('aria-expanded'), 'false');
  await page.screenshot({ path: `${output}/admin-reduced-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: '로그아웃', exact: false }).click();
  await signIn('user');
  await page.getByRole('heading', { name: '내 돈을 한눈에' }).waitFor();
  assert.equal(await page.locator('.veriface-admin').count(), 0);
  assert.equal(await page.evaluate(() => window.cameraRequests), 0, 'role entry never requests a camera');
  assert.deepEqual(errors, []);
  const evidence = { url, entry: 'frontend/src/App.tsx', userWidths: [360,390,430], adminWidths: [1280,1440], adminDatasetRequests: adminRequests.length, cameraRequests: 0, errors, doubles: ['role login response', 'face context', 'API fallback and dataset failures'], checks: ['duplicate login submits remain one request', 'role/logout isolation', 'admin failure cannot block user', 'both CSS imports', 'menus', 'keyboard tooltip/Escape', 'reduced motion', 'mobile menu focus', 'no overflow'] };
  await writeFile(`${output}/app-evidence.json`, JSON.stringify(evidence, null, 2) + '\n');
  console.log('PASS actual App: role/logout, dataset isolation, responsive CSS, menu/tooltip/focus, reduced motion, zero camera requests');
} finally { await browser.close(); }
