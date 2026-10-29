import { openUserPreview } from './app-browser-helper.mjs';
// Runtime motion/accessibility checks. Uses camera/API stubs; never opens a real camera.
// PLAYWRIGHT_MODULE=/existing/playwright/index.mjs node frontend/tests/user-motion.browser.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' });
const output = process.env.MOTION_OUTPUT || '/tmp/veriface-user-motion';
await mkdir(output, { recursive: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.motionCalls = [];
  window.cameraRequests = 0;
  const original = Element.prototype.animate;
  Element.prototype.animate = function (frames, options) {
    const animation = original.call(this, frames, options);
    window.motionCalls.push({ target: this.className?.baseVal ?? this.className, frames, duration: options.duration });
    return animation;
  };
  navigator.mediaDevices.getUserMedia = () => {
    window.cameraRequests++;
    return new Promise((resolve, reject) => { window.rejectCamera = () => reject(new DOMException('권한 거부 대역', 'NotAllowedError')); });
  };
});
await page.route('**/api/face/context', route => route.fulfill({ json: { mode: 'local', user_label: '사용자', registered: false, ready: true, blockers: [], csrf_token: 'motion-test' } }));
const url = process.env.PREVIEW_URL || 'http://127.0.0.1:5187/user-preview.html';
const clearMotion = () => page.evaluate(() => { window.motionCalls = []; });
const screenMotion = () => page.evaluate(() => window.motionCalls.filter(item => String(item.target).includes('vf-user__main')));
async function fillDraft() {
  await page.getByRole('textbox', { name: '받는 사람' }).fill('친구');
  await page.getByRole('textbox', { name: '받는 계좌' }).fill('1234-5678');
  await page.getByRole('textbox', { name: '보낼 금액' }).fill('30000');
}
try {
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await openUserPreview(page, url);
    await page.getByRole('heading', { name: '내 돈을 한눈에' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `home overflow at ${width}`);
    await clearMotion();
    const send = page.getByRole('button', { name: '송금하기' });
    const bounds = await send.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.waitForFunction(() => {
      const button = document.querySelector('.vf-user__account button');
      return getComputedStyle(button).transform === 'matrix(0.97, 0, 0, 0.97, 0, 0)';
    });
    await page.mouse.up();
    await page.getByRole('heading', { name: '어디로 보낼까요?' }).waitFor();
    assert.equal(await page.locator('form').count(), 1);
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'H1');
    const forward = await screenMotion();
    assert.equal(forward.length, 1);
    assert.equal(forward[0].duration, 220);
    assert.equal(forward[0].frames[0].transform, 'translateX(18px)');
    await fillDraft();
    const amount = page.getByRole('textbox', { name: '보낼 금액' });
    await amount.focus();
    await amount.evaluate(input => input.setSelectionRange(2, 2));
    await page.keyboard.insertText('1');
    assert.deepEqual(await amount.evaluate(input => ({ value: input.value, caret: input.selectionStart, focused: document.activeElement === input })), { value: '301000', caret: 3, focused: true });
    await amount.fill('30000');
    await page.getByRole('button', { name: '다음' }).click();
    assert.equal(await page.locator('form').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'H1');
    await clearMotion();
    // DOM clicks intentionally bypass animation-stability waiting to exercise rapid navigation.
    await page.getByRole('button', { name: '이전 화면으로 돌아가기' }).evaluate(button => button.click());
    assert.equal((await screenMotion())[0].frames[0].transform, 'translateX(-18px)');
    assert.equal(await amount.inputValue(), '30000');
    for (let index = 0; index < 3; index++) {
      await page.getByRole('button', { name: '다음' }).evaluate(button => { button.click(); button.click(); });
      assert.equal(await page.locator('main').count(), 1);
      await page.getByRole('button', { name: '송금 정보 수정' }).evaluate(button => button.click());
      assert.equal(await amount.inputValue(), '30000');
      assert.equal(await page.getByRole('textbox', { name: '받는 사람' }).inputValue(), '친구');
      assert.equal(await page.locator('form').count(), 1);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `input overflow at ${width}`);
    await page.screenshot({ path: `${output}/input-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '다음' }).click();
  await clearMotion();
  await page.getByRole('button', { name: '얼굴로 확인하기' }).click();
  assert.equal(await page.locator('video').count(), 1);
  assert.equal((await screenMotion()).length, 0, 'capture excluded from slide/fade');
  assert.equal(await page.evaluate(() => window.cameraRequests), 0);
  await page.getByRole('button', { name: '얼굴 최초 등록 시작' }).click();
  await page.locator('.vf-user--working').waitFor();
  const pendingButton = page.locator('button[aria-busy="true"]');
  assert.equal(await pendingButton.isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '촬영 취소' }).isEnabled(), true);
  assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length), 0, 'capture must have no running motion');
  assert.equal(await page.locator('.vf-user__spinner').evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.getByRole('button', { name: '촬영 취소' }).click();
  await page.evaluate(() => window.rejectCamera());
  assert.equal(await page.locator('video').count(), 0);
  assert.equal(await page.getByRole('heading', { name: '송금 완료' }).count(), 0);
  await page.getByRole('button', { name: '송금 정보 수정' }).click();
  assert.equal(await page.getByRole('textbox', { name: '보낼 금액' }).inputValue(), '30000');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await clearMotion();
  await page.getByRole('button', { name: '다음' }).click();
  await page.getByRole('button', { name: '송금 정보 수정' }).click();
  assert.deepEqual(await page.evaluate(() => window.motionCalls), []);
  const buttonStyles = await page.getByRole('button', { name: '다음' }).evaluate(button => ({ animation: getComputedStyle(button).animationName, transition: getComputedStyle(button).transitionDuration }));
  assert.equal(buttonStyles.animation, 'none');
  assert.equal(buttonStyles.transition, '0s');
  await page.getByRole('textbox', { name: '보낼 금액' }).fill('0');
  await page.getByRole('button', { name: '다음' }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('alert').evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.getByRole('textbox', { name: '보낼 금액' }).fill('30000');
  await page.getByRole('button', { name: '다음' }).click();
  await page.getByRole('button', { name: '얼굴로 확인하기' }).click();
  assert.equal(await page.locator('video').count(), 1);
  assert.equal(await page.getByRole('button', { name: '얼굴 최초 등록 시작' }).isEnabled(), true);
  assert.deepEqual(errors, []);
  console.log('PASS: 360/390/430px; 220ms forward/back keyframes; one mounted screen/form/video; rapid navigation/double-click draft preservation; title focus and amount caret; capture motion lock/pending cancellation; reduced-motion disables WAAPI/CSS and preserves flow');
} finally { await browser.close(); }
