// No real Worker or SpoSched calls. Reproduce a response delivered after
// changing the SS environment while an official snapshot GET is in flight.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,
 ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const E='11111111-1111-4111-8111-111111111111';
const ids=[1,2,3,4].map(n=>'33333333-3333-4333-8333-33333333333'+n);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const oldRequest=deferred(),allowOldResponse=deferred();
let productionSnapshots=0,stagingSnapshots=0,writes=0;
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.host==='peakstamp.local'){
  const path=url.pathname==='/'?'sposched-review.html':url.pathname.slice(1);
  try{return await route.fulfill({body:await readFile(new URL('../'+path,import.meta.url)),
   contentType:path.endsWith('.html')?'text/html':'text/javascript'});}
  catch{return route.fulfill({status:404,body:'Missing local asset '+path});}
 }
 assert.ok(['shoot-sunday-sync.yomax1979.workers.dev',
  'shoot-sunday-sync-staging.yomax1979.workers.dev'].includes(url.host));
 if(route.request().method()!=='GET'){writes++;throw Error('Unexpected POST');}
 if(url.pathname==='/events'){
  return route.fulfill({json:{events:[{event_id:E,name:'Test event',date:'2026-10-25',status:'scheduled'}]},
   headers:{'Access-Control-Allow-Origin':'*'}});
 }
 if(url.pathname==='/snapshot'){
  const production=url.host==='shoot-sunday-sync.yomax1979.workers.dev';
  if(production){productionSnapshots++;oldRequest.resolve();await allowOldResponse.promise;}
  else stagingSnapshots++;
  return route.fulfill({json:{event_id:E,matches:ids.map((match_id,i)=>({
   seq:i+1,match_id,title:i<2?'準決勝':'決勝',
   status:i<2?'scheduled':'waiting',left_team:i<2?'チーム1':'',
   right_team:i<2?'チーム2':'',left_score:0,right_score:0,goals:[]
  })),roster:{チーム1:['山田'],チーム2:['西村']}},
   headers:{'Access-Control-Allow-Origin':'*'}});
 }
 throw Error('Unexpected path '+url.pathname);
});
try{
 await page.goto('https://peakstamp.local/');
 await page.fill('#ssBridgeToken','same-token');
 await page.click('#ssLoadEvents');
 await page.locator('#ssLoadSnapshot').waitFor({state:'visible'});
 await page.click('#ssLoadSnapshot');
 await oldRequest.promise;
 assert.equal(productionSnapshots,1);
 // The user switches from production to TEST while the old GET is pending.
 await page.selectOption('#ssEnvironment','staging');
 await page.fill('#ssBridgeToken','same-token');
 allowOldResponse.resolve();
 await page.waitForFunction(()=>!document.getElementById('ssLoadSnapshot').disabled);
 assert.equal(await page.locator('#reviewArea').isVisible(),false);
 assert.equal(await page.locator('#ssSelectWrap').isVisible(),false);
 assert.equal(await page.locator('#stagingSendArea').isVisible(),false);
 assert.match(await page.locator('#ssDirectStatus').innerText(),/テスト環境/);
 // A new, independently scoped TEST load must still work.
 await page.click('#ssLoadEvents');
 await page.locator('#ssLoadSnapshot').waitFor({state:'visible'});
 await page.click('#ssLoadSnapshot');
 await page.waitForFunction(()=>document.getElementById('ssDirectStatus').textContent.includes('テスト読み込み成功'));
 assert.equal(stagingSnapshots,1);
 assert.equal(writes,0);
 assert.deepEqual(errors,[]);
 console.log('PASS: stale production GET discarded after TEST switch; new TEST GET succeeds; zero writes');
}finally{allowOldResponse.resolve();await browser.close();}
