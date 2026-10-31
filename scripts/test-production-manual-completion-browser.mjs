// Real HTML/callback wiring with intercepted Worker HTTP only. No live writes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {manualStoreKey} from '../sposched-manual-goals.mjs';
import {productionBatchStorageKey} from '../sposched-production-release.mjs';
import {productionSubmissionKey} from '../sposched-production-submission.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const id=n=>'65656565-6565-4565-8565-'+String(n).padStart(12,'0');
const E=id(90),T=id(89);
const snapshot={kind:'peakstamp-sposched-snapshot',version:1,source:'SpoSched Match API v1.3',
 roster_source:'official-current-event-teams',event_id:E,event:{name:'Synthetic league',date:'2026-11-01',status:'target'},
 roster:{Blue:['A','Assist A'],Red:['B'],Green:['C'],Yellow:['D']},
 matches:[1,2].map((seq,i)=>({seq,match_id:id(seq),title:'League round '+seq,status:'scheduled',
  left_team:i?'Green':'Blue',right_team:i?'Yellow':'Red',left_score:0,right_score:0,goals:[]}))};
let submitted,completed=false,starts=0,inspections=0,releaseStart;
const startGate=new Promise(resolve=>releaseStart=resolve);
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url());
 if(url.host==='peakstamp.local'){
  assert.equal(request.method(),'GET');
  const path=url.pathname==='/'?'sposched-review.html':url.pathname.slice(1);
  assert.ok(!path.includes('..'));
  const body=await readFile(new URL('../'+path,import.meta.url));
  return route.fulfill({body,contentType:path.endsWith('.html')?'text/html':'text/javascript'});
 }
 assert.equal(url.host,'shoot-sunday-sync.yomax1979.workers.dev','all external HTTP is intercepted at the synthetic Worker');
 let json;
 if(request.method()==='GET'){
  if(url.pathname==='/events')json={events:[{event_id:E,date:'2026-11-01',name:'Synthetic league',status:'target'}]};
  else if(url.pathname==='/snapshot')json=structuredClone(snapshot);
  else if(url.pathname==='/production/release-state')json={environment:'PRODUCTION',event_id:E,target_event_id:E,scope:'current-target',release_ready:true};
  else if(url.pathname==='/production/inspect')json={environment:'PRODUCTION',mode:'read-only',event_id:E,team_id:T,team_pinned:true,
   event_date:'2026-11-01',write_allowed:false,release_approved:false,matches:snapshot.matches.map(m=>({seq:m.seq,match_id:m.match_id,status:m.status}))};
  else throw Error('Unexpected intercepted read '+url.pathname);
 }else{
  assert.equal(request.method(),'POST');
  const body=request.postDataJSON();
  assert.equal(body.event_id,E);
  if(url.pathname==='/production/batch/start'){
   starts++;assert.equal(starts,1,'no duplicate start');submitted=body;
   assert.equal(body.layout_mode,'independent-fixtures-v1');assert.equal(body.fixture_count,2);
   assert.equal(body.operations.filter(o=>o.action==='create').length,1);
   assert.equal(body.operations.find(o=>o.action==='create').scorer,'A');
   await startGate;
   for(const match of snapshot.matches){match.status='finished';match.winner=match.seq===1?'left':'draw';}
   snapshot.matches[0].left_score=1;
   snapshot.matches[0].goals=[{goal_id:id(500),team:'Blue',scorer:'A',assist:'Assist A',own_goal:false}];
   completed=true;json={status:'running'};
  }else if(url.pathname==='/production/batch/inspect'){
   inspections++;assert.equal(body.request_id,submitted.request_id);
   json={environment:'PRODUCTION',event_id:E,request_id:submitted.request_id,inspection_only:true,
    layout_mode:'independent-fixtures-v1',fixture_count:2,fixture_ids:{1:id(1),2:id(2)},
    status:completed?'completed':'running',completed:completed?3:0,total:3};
  }else throw Error('Unexpected intercepted mutation '+url.pathname);
 }
 return route.fulfill({json,headers:{'Access-Control-Allow-Origin':'*'}});
});
const productionKey=manualStoreKey('production',E),stagingKey=manualStoreKey('staging',E);
const stored=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),productionKey);
async function load(){
 await page.goto('https://peakstamp.local/');
 await page.fill('#ssBridgeToken','synthetic-bridge-only');
 await page.click('#ssLoadEvents');
 await page.locator('#ssLoadSnapshot').waitFor({state:'visible'});
 await page.click('#ssLoadSnapshot');
 await page.locator('#productionPanel').waitFor({state:'visible'});
}
try{
 await load();await page.click('#quickEdit');await page.click('#manualAddGoal');
 const row=page.locator('#goalRows article').first(),fields=row.locator('.fields select');
 await fields.nth(0).selectOption('1');await fields.nth(1).selectOption('A');
 await fields.nth(2).selectOption('named');await fields.nth(3).selectOption('Assist A');await fields.nth(4).selectOption('Blue');
 await row.locator('label').filter({hasText:'このゴールの試合・選手を確認した'}).locator('input').check();
 const originalId=(await stored())[0].id;
 await page.click('#productionCheck');
 await page.waitForFunction(()=>!document.getElementById('productionStart').disabled);
 await page.click('#productionStart');
 await page.waitForFunction(key=>localStorage.getItem(key)!==null,productionSubmissionKey(E));
 assert.equal((await stored())[0].sent,false,'submitted draft stays unsent before official completion');
 const marker=await page.evaluate(key=>localStorage.getItem(key),productionBatchStorageKey(E));
 assert.equal(marker,submitted.request_id,'request marker persists before mocked start ACK');
 // A local draft added after the immutable submission must not be marked sent.
 await page.click('#manualAddGoal');
 const draftsBefore=await stored();assert.equal(draftsBefore.length,2);
 const lateId=draftsBefore.find(g=>g.id!==originalId).id;
 releaseStart();
 await page.waitForFunction(({key,id})=>JSON.parse(localStorage.getItem(key)||'[]').find(g=>g.id===id)?.sent===true,
  {key:productionKey,id:originalId});
 let drafts=await stored();
 assert.equal(drafts.find(g=>g.id===lateId).sent,false);
 assert.equal(await page.evaluate(key=>localStorage.getItem(key),stagingKey),null);
 assert.equal(starts,1);assert.ok(inspections>=1);
 // Reopening the actual page restores both identities, refreshes the old job,
 // and preserves the late draft without a second start request.
 await load();await page.click('#quickEdit');
 await page.waitForFunction(()=>document.getElementById('productionStatus').textContent.includes('SSで確認'));
 drafts=await stored();assert.equal(drafts.find(g=>g.id===originalId).sent,true);
 assert.equal(drafts.find(g=>g.id===lateId).sent,false);
 assert.equal(await page.locator('#goalRows article').count(),1,'only the late unsent manual draft is editable');
 assert.equal(starts,1);assert.deepEqual(errors,[]);
 console.log('PASS: actual production HTML persists only submitted manual completion; late draft and reload preserved; all HTTP mocked');
}finally{releaseStart();await browser.close();}
