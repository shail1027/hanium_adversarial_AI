import { openUserPreview } from './app-browser-helper.mjs';
// Transport/camera stubs only: no real face, camera, backend, or FULL approval.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless:true,channel:process.env.BROWSER_CHANNEL || 'chrome',args:['--disable-gpu'] });
const reduced = process.env.REDUCED_MOTION === '1';
const page = await browser.newPage({viewport:{width:390,height:844},reducedMotion: reduced ? 'reduce' : 'no-preference'});
await page.addInitScript(()=>{
  window.stoppedTracks=0;
  // Invoke the real 90-second handler deterministically; no wall-clock performance claim.
  const schedule = window.setTimeout;
  window.setTimeout = (callback, delay, ...args) => {
    const id = schedule(callback, delay, ...args);
    if (delay === 90000) window.captureTimeout = () => { clearTimeout(id); callback(...args); };
    return id;
  };
  window.motionEvents=[];
  const animate=Element.prototype.animate;
  Element.prototype.animate=function(frames,options){
    window.motionEvents.push({target:this.tagName,cls:this.getAttribute('class'),row:this.getAttribute('data-transaction-id')});
    return animate.call(this,frames,options);
  };
  navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[{stop:()=>window.stoppedTracks++}]});
  Object.defineProperty(HTMLMediaElement.prototype,'srcObject',{set(){},get(){return null},configurable:true});
  HTMLMediaElement.prototype.play=async()=>{};
  for(const [name,value] of Object.entries({videoWidth:640,videoHeight:480,readyState:4})) Object.defineProperty(HTMLVideoElement.prototype,name,{get:()=>value,configurable:true});
  HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});
  HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,TEST_TRANSPORT_ONLY';
});
let registered=false, operation, session=0, decision='ACCEPT', consumed=true, mismatch=false, holdConsume=false, releaseConsume;
let consumeCount=0, networkFailure, holdVerify=false, releaseVerify;
const frameRecords=[];
let runPassed=false;
function frameReport() {
  const attempts=[...new Set(frameRecords.map(record=>record.attempt))].map(attempt=>{
    const records=frameRecords.filter(record=>record.attempt===attempt);
    const gaps=records.slice(1).map((record,index)=>record.timestamp_ms-records[index].timestamp_ms);
    const durations=records.map(record=>record.route_duration_ms).filter(Number.isFinite);
    return {attempt,frame_count:records.length,
      timestamp_gaps_ms:gaps,
      route_durations_ms:durations,
      max_timestamp_gap_ms:gaps.length?Math.max(...gaps):null,
      max_route_duration_ms:durations.length?Math.max(...durations):null};
  });
  return {passed:runPassed,reduced_motion:reduced,capture_duration_ms:3000,max_frames:80,
    minimum_frames:10,clock:'native performance.now / requestAnimationFrame',
    scope:'API/camera transport doubles; no real camera or FULL approval',attempts};
}
await page.route('**/api/face/**',async route=>{
  const path=new URL(route.request().url()).pathname.split('/').pop();
  let frameRecord;
  if(path==='frame') {
    const frame=route.request().postDataJSON();
    frameRecord={attempt:session,frame_id:frame.frame_id,timestamp_ms:frame.timestamp_ms,
      route_started_ms:performance.now()};
    frameRecords.push(frameRecord);
  }
  try {
    let body={};
    if(path==='context') body={mode:'local',registered,ready:true,user_label:'대역',csrf_token:'test',blockers:[]};
    if(path==='start') {operation=route.request().postDataJSON().operation;body={session_id:`stub-${++session}`,nonce:'test',challenge:'대역 안내: 오른쪽을 보세요',expires_in_sec:90};}
    if(path==='present') {
      // Match the real web server's minimum capture plan; per-frame browser assertions add transport overhead.
      body={capture_duration_ms:3000,max_frames:80,illumination:[{offset_ms:500,duration_ms:300,color:[12,40,255]}]};
    }
    if(path==='frame') body={accepted:true};
    if(['start','present','frame','verify','consume'].includes(path)) {
      // One atomic browser snapshot keeps every assertion off separate RPC roundtrips.
      const frozen=await page.evaluate(()=>{
        const root=document.querySelector('.vf-user');
        return {running:document.getAnimations().filter(a=>a.playState==='running').length,
          locked:!!document.querySelector('.vf-user--working'),video:document.querySelectorAll('video').length,
          rgb:root?getComputedStyle(root).backgroundColor:null,
          instructions:[...document.querySelectorAll('[role="status"]')].map(element=>element.innerText)};
      });
      assert.equal(frozen.running,0,'no motion during camera/verification');
      assert.equal(frozen.locked,true);assert.equal(frozen.video,1);
      if(path==='present') assert.deepEqual(frozen.instructions,['대역 안내: 오른쪽을 보세요']);
      if(path==='frame') assert.ok(['rgb(255, 255, 255)','rgb(12, 40, 255)'].includes(frozen.rgb),frozen.rgb);
    }
    if(path===networkFailure) { if(path==='consume') consumeCount++; return route.abort('failed'); }
    if(path==='verify') {
      if(holdVerify) await new Promise(resolve=>{releaseVerify=resolve;});
      if(operation==='enroll') { registered=true;body={status:'ENROLLED',registered:true}; }
      else body={session:{session_id:mismatch?'wrong':`stub-${session}`,final_decision:decision,gates:[]},token_id:decision==='ACCEPT'?'test-token':null,authorized:false,account_authenticated:false,user_message:'대역 판정',solutions:[]};
    }
    if(path==='consume') {consumeCount++; if(holdConsume) await new Promise(resolve=>{releaseConsume=resolve;}); body={consumed,account_authenticated:false};}
    await route.fulfill({json:body}).catch(()=>{});
  } finally {
    if(frameRecord) frameRecord.route_duration_ms=performance.now()-frameRecord.route_started_ms;
  }
});
async function open(){
  await openUserPreview(page, process.env.PREVIEW_URL || 'http://127.0.0.1:5187/user-preview.html');
  await page.getByRole('button',{name:'송금하기'}).click();
  await page.getByRole('textbox',{name:'받는 사람'}).fill('친구');
  await page.getByRole('textbox',{name:'받는 계좌'}).fill('1234-5678');
  await page.getByRole('textbox',{name:'보낼 금액'}).fill('30000');
  await page.getByRole('button',{name:'다음'}).click();
  await page.getByRole('button',{name:'얼굴로 확인하기'}).click();
}
try {
  await open();
  await page.getByRole('button',{name:'얼굴 최초 등록 시작'}).click({trial:true});
  await page.getByRole('button',{name:'얼굴 최초 등록 시작'}).evaluate(button=>{button.click();button.click();});
  await page.getByRole('button',{name:'송금 얼굴 인증 시작'}).waitFor();
  assert.equal(consumeCount,0);
  assert.equal(session,1,'double tap starts only one enrollment');
  assert.equal(await page.evaluate(()=>window.motionEvents.filter(e=>e.cls==='vf-user__success').length),0);
  assert.equal(await page.getByRole('heading',{name:'송금 완료'}).count(),0);
  await page.getByRole('button',{name:'송금 얼굴 인증 시작'}).click();
  await page.getByRole('heading',{name:'송금 완료'}).waitFor();
  assert.equal(await page.evaluate(()=>window.motionEvents.filter(e=>e.cls==='vf-user__success').length),reduced ? 0 : 1);
  await page.screenshot({path:'/tmp/veriface-user-screens/receipt-stub-390.png',fullPage:true});
  await page.getByRole('button',{name:'확인',exact:true}).click();
  assert.equal(await page.locator('.vf-user__balance').innerText(),'2,420,000원');
  assert.equal(await page.locator('.vf-user__history li').count(),1);
  assert.equal(await page.evaluate(()=>window.motionEvents.filter(e=>e.row).length),reduced ? 0 : 1);
  await page.getByRole('button',{name:'내 정보',exact:true}).click();
  await page.getByRole('button',{name:'홈',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.motionEvents.filter(e=>e.row).length),reduced ? 0 : 1,'old history does not replay');
  assert.equal(await page.evaluate(()=>window.motionEvents.filter(e=>e.cls==='vf-user__success').length),reduced ? 0 : 1);
  for(const variant of ['STEP_UP','REJECT','ERROR','consume-false','other-session']) {
    console.log('checking',variant);
    decision=variant.includes('-')?'ACCEPT':variant;consumed=variant!=='consume-false';mismatch=variant==='other-session';
    await open();await page.getByRole('button',{name:'송금 얼굴 인증 시작'}).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.evaluate(()=>window.motionEvents.filter(e=>e.cls==='vf-user__success').length),0);
    assert.equal(await page.getByRole('heading',{name:'송금 완료'}).count(),0);
  }
  decision='ACCEPT';consumed=true;mismatch=false;holdConsume=true;
  await open();await page.getByRole('button',{name:'송금 얼굴 인증 시작'}).click();
  await page.waitForRequest('**/api/face/consume');
  await page.getByRole('button',{name:'촬영 취소'}).click();
  releaseConsume();
  await page.getByRole('button',{name:'이전 화면으로 돌아가기'}).click();
  await page.getByRole('button',{name:'홈으로 돌아가기'}).click();
  assert.equal(await page.locator('.vf-user__balance').innerText(),'2,450,000원');
  assert.equal(await page.locator('.vf-user__history li').count(),0);
  assert.ok(await page.evaluate(()=>window.stoppedTracks)>0);
  holdConsume=false;
  for (const failure of ['verify','consume']) {
    console.log('checking network',failure);
    networkFailure=failure;
    await open();
    const beforeConsume=consumeCount;
    await page.getByRole('button',{name:'송금 얼굴 인증 시작'}).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('heading',{name:'송금 완료'}).count(),0);
    assert.equal(consumeCount-beforeConsume,failure==='consume'?1:0,'lost consume is never guessed or retried');
    await page.getByRole('button',{name:'이전 화면으로 돌아가기'}).click();
    await page.getByRole('button',{name:'이전 화면으로 돌아가기'}).click();
    await page.getByRole('button',{name:'홈으로 돌아가기'}).click();
    assert.equal(await page.locator('.vf-user__balance').innerText(),'2,450,000원');
    assert.equal(await page.locator('.vf-user__history li').count(),0);
  }
  networkFailure=undefined;
  for (const cleanup of ['timeout','pagehide']) {
    console.log('checking cleanup',cleanup);
    holdVerify=true;releaseVerify=undefined;
    await open();
    const beforeConsume=consumeCount;
    const request=page.waitForRequest('**/api/face/verify');
    await page.getByRole('button',{name:'송금 얼굴 인증 시작'}).click();
    await request;
    for(let i=0;!releaseVerify && i<200;i++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(typeof releaseVerify,'function','verify is held before cleanup');
    const stoppedBeforeCleanup=await page.evaluate(()=>window.stoppedTracks);
    if(cleanup==='timeout') await page.evaluate(()=>window.captureTimeout());
    else await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
    if(cleanup==='timeout') await page.getByRole('alert').waitFor();
    else await page.getByRole('heading',{name:'송금 정보를 확인해 주세요'}).waitFor();
    assert.ok(await page.evaluate(()=>window.stoppedTracks)>stoppedBeforeCleanup,'cleanup releases the attempt stream');
    releaseVerify();holdVerify=false;
    await page.waitForTimeout(30);
    assert.equal(consumeCount,beforeConsume,'late ACCEPT after cleanup cannot consume');
    assert.equal(await page.getByRole('heading',{name:'송금 완료'}).count(),0);
    if(cleanup==='timeout') await page.getByRole('button',{name:'이전 화면으로 돌아가기'}).click();
    await page.getByRole('button',{name:'이전 화면으로 돌아가기'}).click();
    await page.getByRole('button',{name:'홈으로 돌아가기'}).click();
    assert.equal(await page.locator('.vf-user__balance').innerText(),'2,450,000원');
    assert.equal(await page.locator('.vf-user__history li').count(),0);
  }
  runPassed=true;
  console.log('PASS lifecycle: verify network rejection, lost consume response, simulated 90s handler, pagehide, late ACCEPT discarded');
  console.log('PASS: stub enrollment separate; ACCEPT+consume receipt; STEP_UP/REJECT/ERROR/consume failure/session mismatch incomplete; cancel pending consume; tracks stopped');
}catch(error){ console.error(await page.locator('main').innerText()); throw error; }finally{
  try {
    if(process.env.BROWSER_REPORT) {
      await mkdir(dirname(process.env.BROWSER_REPORT),{recursive:true});
      await writeFile(process.env.BROWSER_REPORT,JSON.stringify(frameReport(),null,2)+'\n');
    }
  } finally { await browser.close(); }
}
