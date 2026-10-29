import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

export async function checkMotion(browser, url, root) {
  const shots = process.env.ADMIN_SCREENSHOTS || root + '/frontend/tests/admin-screenshots';
  await fs.mkdir(shots, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const requests = new Map();
  const frames = [];
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, time: metadata.timestamp });
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {}); // A final frame can arrive during page cleanup.
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 65, maxWidth: 1280, maxHeight: 900 });
  await page.addInitScript(() => {
    window.motionEvents = [];
    document.addEventListener('animationstart', event => window.motionEvents.push({ name: event.animationName, card: event.target.matches('.admin-card-entry > article'), at: performance.now(), duration: getComputedStyle(event.target).animationDuration, delay: getComputedStyle(event.target).animationDelay }));
  });
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (/^\/(api|forensics|hc160|defense)\//.test(path)) requests.set(path, (requests.get(path) ?? 0) + 1);
  });
  await page.route('**/api/**', route => route.fulfill({ status: 503, body: 'Static fallback test' }));
  let release;
  let hold = new Promise(resolve => { release = resolve; });
  let fail = false;
  await page.route('**/forensics/attack_sessions.csv', async route => {
    if (hold) await hold;
    if (fail) await route.fulfill({ status: 503, body: 'Unavailable' });
    else await route.continue();
  });
  try {
    await page.goto(url);
    await page.locator('.admin-skeletons.admin-metrics').waitFor();
    assert.equal(await page.locator('.metric-ratio').count(), 0, 'no placeholder number before data');
    const skeletonHeight = await page.locator('.admin-skeletons.admin-metrics').evaluate(el => el.getBoundingClientRect().height);
    release(); hold = null;
    await page.getByRole('heading', { name: '공격별 결과', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.admin-card-entry'));
    assert.ok(Math.abs(await page.locator('[data-menu=overview] > .admin-metrics').evaluate(el => el.getBoundingClientRect().height) - skeletonHeight) < 1, 'skeleton and loaded cards stay within one CSS pixel');
    const cards = await page.evaluate(() => window.motionEvents.filter(event => event.card));
    assert.equal(cards.length, 3);
    assert.deepEqual(cards.map(card => [card.duration, card.delay]), [['0.24s','0s'], ['0.24s','0.045s'], ['0.24s','0.09s']], 'live animation timing: 240ms + 90ms = 330ms');
    assert.equal(await page.locator('.metric-ratio').innerText(), '49.05% (981 / 2,000)');
    console.log('Motion: card timing and loading passed');
    const baseRequests = [...requests];
    assert.ok(baseRequests.every(([, count]) => count === 1), 'StrictMode must not duplicate dataset requests');
    const menu = name => page.getByRole('navigation').getByRole('button', { name, exact: true });
    const active = () => page.locator('.admin-page:not([hidden])');
    await menu('공격 분석').click();
    assert.equal(await active().evaluate(el => getComputedStyle(el).animationDuration), '0.18s');
    assert.equal(await active().locator('.vf-bar-track > span').first().evaluate(el => getComputedStyle(el).animationDuration), '0.28s');
    const matrix = (await fs.readFile(root + '/frontend/public/forensics/attack_family_matrix.csv', 'utf8')).trim().split(/\r?\n/);
    const columns = matrix.shift().split(',');
    const pgd = Object.fromEntries(matrix.find(line => line.startsWith('pgd,')).split(',').map((value, index) => [columns[index], value]));
    const tooltipButton = page.getByRole('button', { name: 'pgd 수치와 분모 보기', exact: true });
    await tooltipButton.hover();
    const hoverBox = await page.getByRole('tooltip').boundingBox();
    assert.ok(hoverBox);
    await page.mouse.move(hoverBox.x + hoverBox.width / 2, hoverBox.y + hoverBox.height / 2);
    await page.waitForTimeout(160); // Exceeds delayed close: pointer on popup must keep it open.
    assert.equal(await page.locator('[popover]:popover-open').count(), 1);
    await tooltipButton.focus();
    const tip = page.getByRole('tooltip');
    await tip.waitFor();
    assert.ok((await tip.innerText()).includes(`${Number(pgd.accepted_after_attack).toLocaleString('ko-KR')} / ${Number(pgd.sessions).toLocaleString('ko-KR')}`));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[popover]:popover-open').count(), 0);
    console.log('Motion: tooltip values and hover passed');
    const filters = active().locator('.vf-filters');
    for (const value of ['high', 'low', 'critical', 'all', 'critical']) await filters.getByRole('button', { name: value, exact: true }).first().click();
    const rows = active().locator('#sessions table button');
    await rows.nth(1).click();
    const selected = await rows.nth(1).innerText();
    const table = active().locator('#sessions .vf-table-wrap');
    await table.evaluate(el => { el.scrollLeft = 180; el.scrollTop = 60; });
    const scroll = await table.evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }));
    const detail = page.getByRole('button', { name: '전체 공격 조건·측정값', exact: true });
    await detail.click();
    const content = page.locator(`[id="${await detail.getAttribute('aria-controls')}"]`);
    await page.waitForFunction(id => document.getElementById(id).getAnimations().length === 0, await detail.getAttribute('aria-controls'));
    assert.equal(await content.getAttribute('aria-hidden'), 'false');
    await detail.click();
    assert.equal(await content.evaluate(el => el.inert), true, 'closing content immediately inert');
    await detail.click(); await detail.click(); await detail.click();
    assert.equal(await detail.getAttribute('aria-expanded'), 'true');
    await menu('인증 결과').click();
    await page.getByLabel('판정 / 이벤트').selectOption('REJECT');
    await menu('공격 분석').click();
    assert.equal(await filters.getByRole('button', { name: 'critical', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await active().locator('#sessions table button[aria-pressed=true]').innerText(), selected);
    assert.equal(await active().locator('.vf-detail-header h2').innerText(), selected);
    assert.deepEqual(await table.evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop })), scroll);
    assert.equal(await detail.getAttribute('aria-expanded'), 'true');
    await menu('인증 결과').click();
    assert.equal(await page.getByLabel('판정 / 이벤트').inputValue(), 'REJECT');
    for (const name of ['방어 분석', '개요', '실험 기록', '공격 분석', '개요']) await menu(name).click();
    assert.equal(await page.locator('.admin-page:not([hidden])').count(), 1);
    const focusedHidden = await page.evaluate(() => {
      document.querySelector('.admin-page[hidden] button')?.focus();
      return Boolean(document.activeElement.closest('.admin-page[hidden]'));
    });
    assert.equal(focusedHidden, false);
    assert.deepEqual([...requests], baseRequests, 'menu/filter changes never refetch');
    assert.equal(await page.evaluate(() => window.motionEvents.filter(event => event.card).length), 3, 'cards only enter once');
    console.log('Motion: preserved selection, filters, scroll, requests passed');
    // A real, held refresh keeps values visible and buttons disabled; errors keep valid data.
    hold = new Promise(resolve => { release = resolve; });
    await page.getByRole('button', { name: '데이터 새로고침', exact: true }).click();
    await page.getByRole('button', { name: '불러오는 중', exact: true }).waitFor();
    assert.equal(await page.locator('.metric-ratio').innerText(), '49.05% (981 / 2,000)');
    assert.equal(await page.locator('.admin-skeletons.admin-metrics').count(), 0);
    fail = true; release(); hold = null;
    await page.getByRole('button', { name: '다시 불러오기', exact: true }).waitFor();
    assert.equal(await page.locator('.metric-ratio').innerText(), '49.05% (981 / 2,000)');
    fail = false;
    hold = new Promise(resolve => { release = resolve; });
    await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
    await page.getByRole('button', { name: '다시 불러오는 중', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '다시 불러오는 중', exact: true }).isDisabled(), true);
    release(); hold = null;
    await page.getByRole('button', { name: '데이터 새로고침', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.admin-refresh button').disabled);
    assert.equal(await page.getByRole('button', { name: '다시 불러오기', exact: true }).count(), 0);
    console.log('Motion: refresh/retry passed');
    for (const width of [1280, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 761) {
        await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
        await menu('공격 분석').focus(); await page.keyboard.press('Escape');
        assert.equal(await page.locator('#admin-navigation').evaluate(el => el.inert), true);
        assert.equal(await page.getByRole('button', { name: '메뉴 열기', exact: true }).evaluate(el => el === document.activeElement), true);
        await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
      }
      await menu('공격 분석').click();
      await tooltipButton.click();
      await tip.waitFor();
      const bounds = await tip.boundingBox();
      assert.ok(bounds, 'tooltip remains open after click at '+width);
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 900);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await cdp.send('Page.stopScreencast');
    // Reduced motion must remove animations while keeping selection/disclosure/menu behavior.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
    await menu('인증 결과').click();
    await page.getByLabel('판정 / 이벤트').selectOption('all');
    await page.getByRole('region', { name: '분석 세션 목록' }).getByRole('button').first().click();
    const provenance = page.getByRole('button', { name: 'provenance · 실행 artifact / 모델 / 정책', exact: true }).first();
    await provenance.click();
    assert.equal(await provenance.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    await provenance.click();
    assert.equal(await page.locator(`[id="${await provenance.getAttribute('aria-controls')}"]`).evaluate(el => el.inert), true);
    await page.screenshot({ path: shots + '/motion-reduced-mobile.png', fullPage: false });
    const touchContext = await browser.newContext({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true });
    const touchPage = await touchContext.newPage();
    await touchPage.route('**/api/**', route => route.fulfill({ status: 503, body: 'Static fallback test' }));
    await touchPage.goto(url);
    await touchPage.getByRole('heading', { name: '공격별 결과', exact: true }).waitFor();
    await touchPage.getByRole('button', { name: '공격 후 승인 수치와 분모 보기', exact: true }).tap();
    await touchPage.getByRole('tooltip').waitFor();
    assert.equal(await touchPage.getByRole('tooltip').innerText(), '49.05% (981 / 2,000)');
    await touchPage.getByRole('heading', { name: '보안 현황', exact: true }).tap();
    assert.equal(await touchPage.locator('[popover]:popover-open').count(), 0, 'touch outside dismisses');
    await touchContext.close();
    await fs.writeFile(shots + '/motion-evidence.json', JSON.stringify({ viewports: [1440,1280,390,360], cards, requests: [...requests], checks: ['one-time cards','180ms page / 280ms bars','original tooltip values','retained filters/selection/scroll','hidden focus excluded','no navigation requests','refresh retains data on loading/error','retry spinner','mobile Escape/focus/inert','tooltip viewport bounds','reduced-motion zero animations','touch tooltip and outside dismissal'], capturedFrames: frames.length }, null, 2) + '\n');
    // Encode actual CDP screen frames with Chromium's built-in WebM encoder; no new dependency.
    const encoder = await browser.newPage();
    const base64 = await encoder.evaluate(async frames => {
      const canvas = document.createElement('canvas');
      const first = new Image(); first.src = 'data:image/jpeg;base64,' + frames[0].data; await first.decode();
      canvas.width = first.width; canvas.height = first.height;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(20);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
      const chunks = []; recorder.ondataavailable = event => chunks.push(event.data);
      const done = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.start();
      for (let i=0;i<frames.length;i++) {
        const img = new Image(); img.src = 'data:image/jpeg;base64,' + frames[i].data; await img.decode();
        ctx.fillStyle = '#100e1b'; ctx.fillRect(0,0,canvas.width,canvas.height);
        const scale = Math.min(canvas.width/img.width, canvas.height/img.height);
        ctx.drawImage(img,(canvas.width-img.width*scale)/2,0,img.width*scale,img.height*scale);
        const delay = i+1<frames.length ? Math.min(350,Math.max(30,(frames[i+1].time-frames[i].time)*1000)) : 150;
        await new Promise(resolve => setTimeout(resolve,delay));
      }
      recorder.stop(); await done; stream.getTracks().forEach(track => track.stop());
      return await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' })); });
    }, frames);
    await fs.writeFile(shots + '/admin-motion.webm', Buffer.from(base64, 'base64'));
    await encoder.close();
    console.log('PASS motion: live animation events, request counts, retained state, refresh/retry, mobile/focus/tooltip, reduced-motion; WebM captured.');
  } finally { release?.(); await page.close(); }
}
