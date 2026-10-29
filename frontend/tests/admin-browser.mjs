import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const preview = path.join(root, 'frontend/admin-check.html');
const entry = path.join(root, 'frontend/src/admin/AdminCheck.tsx');
const port = process.env.ADMIN_TEST_PORT ?? '5198';
await fs.writeFile(preview, '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/admin/AdminCheck.tsx"></script></body></html>');
await fs.writeFile(entry, `import React from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import { AdminDashboard } from './AdminDashboard';
import type { FaceAuthVerifyResponse } from '../api';
const runtime: FaceAuthVerifyResponse = {session:{schema_version:'1.0',session_id:'runtime-test-only',status:'COMPLETED',final_decision:'STEP_UP',created_at:'2026-10-29T00:00:00Z',completed_at:null,latency_ms:null,attempt_count:1,query_budget:{used:null,limit:null,exceeded:null},gates:[{gate_id:'RAW_SCORE',display_layer:null,status:'SCORED',role:'SCORING',latency_ms:null,score:0,threshold:null,reason_code:null,provenance:{artifact_id:'test-only',artifact_version:'backend-test-dirty',model_version:'test-model',policy_version:'test-policy'}},{gate_id:'RAW_PENDING',display_layer:null,status:'NOT_EVALUATED',role:'SCORING',latency_ms:null,score:null,threshold:null,reason_code:null,provenance:{artifact_id:'test-only',artifact_version:'backend-test-dirty',model_version:'test-model',policy_version:'test-policy'}}],decision_provenance:{source:'hc160_runtime',security_profile:'FULL',runtime_identity:{backend_commit:'backend-test',backend_dirty:true,web_commit:'unknown',web_dirty:null}}},user_message:'명시적 UI 테스트 대역',next_action:'step_up',solutions:[],attack_detected:false,authorized:false,account_authenticated:false,token_id:null};
createRoot(document.getElementById('root')!).render(<React.StrictMode><AdminDashboard user={{display_name:'관리자'}} onLogout={()=>{document.title='로그아웃 콜백 확인';}} runtimeResult={location.search ? runtime : undefined}/></React.StrictMode>);
`);
const server = spawn(process.execPath, [path.join(root,'frontend/node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',port,'--strictPort'], {cwd:path.join(root,'frontend'),stdio:'ignore'});
let browser;
try {
for(let i=0;i<100;i++) { try { const res=await fetch('http://127.0.0.1:'+port+'/admin-check.html'); if(res.ok) break; } catch {} await new Promise(resolve=>setTimeout(resolve,100)); }
browser = await chromium.launch({headless:true, channel:process.env.ADMIN_BROWSER_CHANNEL ?? 'chrome'});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',route=>route.fulfill({status:503,body:'Preview: static fallback'}));
const shots=root+'/frontend/tests/admin-screenshots'; await fs.mkdir(shots,{recursive:true});
await page.goto('http://127.0.0.1:'+port+'/admin-check.html');
await page.getByRole('heading',{name:'공격별 결과',exact:true}).waitFor();
await page.getByText('PGD',{exact:true}).waitFor();
assert.equal(await page.locator('h1').evaluate(el=>getComputedStyle(el).color),'rgb(244, 241, 250)');
assert.equal(await page.locator('.admin-metrics strong').first().evaluate(el=>getComputedStyle(el).color),'rgb(244, 241, 250)');
assert.equal(await page.locator('td').first().evaluate(el=>getComputedStyle(el).color),'rgb(244, 241, 250)');
await page.screenshot({path:shots+'/overview-desktop.png',fullPage:true});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
for (const [menu,file] of [['인증 결과','authentication'],['공격 분석','attack'],['방어 분석','defense'],['실험 기록','experiments']]) {
 await page.getByRole('navigation',{name:'관리자 메뉴'}).getByRole('button',{name:menu,exact:true}).click();
 if(menu==='인증 결과') assert.equal(await page.locator('.vf-detail-grid dd').first().evaluate(el=>getComputedStyle(el).color),'rgb(244, 241, 250)');
 await page.screenshot({path:shots+'/'+file+'-desktop.png',fullPage:menu!=='방어 분석' && menu!=='실험 기록'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,menu+' desktop overflow');
}
await page.getByRole('navigation').getByRole('button',{name:'인증 결과',exact:true}).click();
await page.getByLabel('판정 / 이벤트').selectOption('ACCEPT');
await page.getByText('이 세션의 상세 결과는 제공되지 않습니다.',{exact:false}).waitFor();
assert.equal(await page.getByRole('heading',{name:'게이트 결과',exact:true}).count(),0);
await page.getByLabel('판정 / 이벤트').selectOption('all');
const selectButtons=page.getByRole('region',{name:'분석 세션 목록'}).getByRole('button');
await selectButtons.first().focus(); await page.keyboard.press('Enter');
assert.equal(await selectButtons.first().getAttribute('aria-pressed'),'true');
await page.getByRole('navigation').getByRole('button',{name:'공격 분석',exact:true}).click();
const filters=page.locator('.vf-filters');
await filters.getByRole('button',{name:'low',exact:true}).click();
await filters.getByRole('button',{name:'accepted',exact:true}).click();
// Contradicting fixture combination produces an empty filter; no stale detail should survive.
if (await page.getByText('조건에 맞는 실험 세션이 없습니다.').count()) assert.equal(await page.locator('.vf-identity-route').count(),0);
await filters.getByRole('button',{name:'all',exact:true}).first().click();
await filters.getByRole('button',{name:'all',exact:true}).last().click();
const riskButtons=page.locator('#sessions table button'); await riskButtons.nth(1).focus(); await page.keyboard.press('Enter');
assert.equal(await riskButtons.nth(1).getAttribute('aria-pressed'),'true');
for(const width of [1280,390,360]) {
 await page.setViewportSize({width,height:900});
 if(width<761) await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'개요',exact:true}).click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'overview '+width);
 await page.screenshot({path:shots+'/overview-'+width+'.png',fullPage:true});
 if(width<761) await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'공격 분석',exact:true}).click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'attack '+width);
 if(width===390) await page.screenshot({path:shots+'/attack-mobile.png',fullPage:true});
}
for (const menu of ['인증 결과','방어 분석','실험 기록']) {
 await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:menu,exact:true}).click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,menu+' mobile overflow');
}
// Empty CSV populations must never become a success percentage.
await page.route('**/forensics/attack_sessions.csv', route=>route.fulfill({status:200,body:'session_id,attack_family,risk_level,accepted_after_attack\n'}));
await page.route('**/defense/*.csv', route=>route.fulfill({status:200,body:'sample_id\n'}));
await page.reload();
await page.getByRole('heading',{name:'공격별 결과',exact:true}).waitFor();
assert.equal(await page.locator('.metric-ratio').innerText(),'미집계');
await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();
await page.getByRole('navigation').getByRole('button',{name:'방어 분석',exact:true}).click();
await page.getByText('미집계',{exact:true}).first().waitFor();
assert.equal(await page.getByText('미집계',{exact:true}).count(),6);
await page.unroute('**/forensics/attack_sessions.csv');
await page.unroute('**/defense/*.csv');
// A failed source must not prevent independent HC160 inspection.
await page.route('**/forensics/**',route=>route.fulfill({status:503,body:'Unavailable'}));
await page.reload();
await page.getByRole('button',{name:'다시 불러오기'}).waitFor();
await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();
await page.getByRole('navigation').getByRole('button',{name:'인증 결과',exact:true}).click();
await page.getByRole('heading',{name:'분석 세션',exact:true}).waitFor();
await page.route('**/hc160/**', route=>route.fulfill({status:503,body:'invalid unavailable fixture'}));
await page.goto('http://127.0.0.1:'+port+'/admin-check.html?runtime-test');
await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();
await page.getByRole('navigation').getByRole('button',{name:'인증 결과',exact:true}).click();
await page.getByRole('heading',{name:'전달받은 실제 얼굴 API 결과',exact:true}).waitFor();
await page.getByText('SCORED · 점수 산출',{exact:true}).waitFor();
await page.getByText('NOT_EVALUATED · 미평가',{exact:true}).waitFor();
assert.equal(await page.getByText('미분류 (null)',{exact:true}).count(),2);
assert.ok((await page.locator('main').innerText()).includes('hc160_runtime'));
await page.getByText('provenance · 실행 artifact / 모델 / 정책',{exact:true}).first().click();
await page.getByText('backend-test-dirty',{exact:true}).first().waitFor();
await page.getByRole('button',{name:'다시 불러오기'}).waitFor();
await page.screenshot({path:shots+'/runtime-test-mobile.png',fullPage:true});
await page.getByRole('button',{name:'로그아웃',exact:false}).click();
assert.equal(await page.title(),'로그아웃 콜백 확인');
assert.deepEqual(errors,[]);
console.log('PASS: 5 menus, 1440/1280/390/360 layouts, keyboard selection, filters, empty populations, source failure isolation, runtime nullable/provenance, theme contrast, logout; screenshots: '+shots);
} finally { await browser?.close(); server.kill(); await fs.rm(preview,{force:true}); await fs.rm(entry,{force:true}); }
