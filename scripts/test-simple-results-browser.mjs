// All traffic is mocked. No live SS writes or credentials.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildStagingReviewHtml} from './build-staging-site.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const E='11111111-1111-4111-8111-111111111111';
const fixtures=()=>[1,2,3,4].map(seq=>({seq,match_id:'22222222-2222-4222-8222-22222222222'+seq,
 title:seq<3?'準決勝':seq===3?'3位決定戦':'決勝',status:'scheduled',
 left_team:seq===2?'チーム3':seq===3?'チーム2':'チーム1',right_team:seq===1?'チーム2':seq===2||seq===3?'チーム4':'チーム3',
 left_score:0,right_score:0,goals:[]}));
try{
 for(const scenario of ['new','partial','uncertain','shared-nickname','draft-reload','waiting','missing-score']){
  const matches=fixtures();
  if(scenario==='partial')matches.slice(0,2).forEach(m=>{m.status='finished';m.left_score=1});
  if(scenario==='waiting')matches.slice(2).forEach(m=>{m.status='waiting';m.left_team='';m.right_team=''});
  if(scenario==='missing-score')matches[0].left_score=null;
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.host==='peakstamp.local'){
    const path=u.pathname==='/'?'sposched-review.html':u.pathname.slice(1);
    if(path==='staging-production-disabled.mjs')return route.fulfill({body:'export function installProductionUI(){return {render(){},refresh(){}}}',contentType:'text/javascript'});
    let body=await readFile(new URL('../'+path,import.meta.url),'utf8');
    if(path==='sposched-review.html')body=buildStagingReviewHtml(body);
    return route.fulfill({body,contentType:path.endsWith('.html')?'text/html':'text/javascript'});
   }
   assert.equal(u.host,'shoot-sunday-sync-staging.yomax1979.workers.dev');
   if(route.request().method()==='POST'){
    posts.push({path:u.pathname,body:route.request().postDataJSON()});
    // Definite validation refusal permits inspecting the UI without advancing a job.
    return route.fulfill({status:400,json:{error:{code:'invalid_plan',message:'テスト用の停止'}},headers:{'Access-Control-Allow-Origin':'*'}});
   }
   const data=u.pathname==='/events'?{events:[{event_id:E,name:'日曜定期',date:'2026-11-08'}]}:
    {event_id:E,matches,roster_source:scenario==='draft-reload'?'official-current-event-teams':undefined,roster:scenario==='shared-nickname'?
     {チーム1:['たいせい'],チーム2:['たいせいA'],チーム3:['田中'],チーム4:['橋本']}:
     {チーム1:['山田'],チーム2:['西村'],チーム3:['田中'],チーム4:['橋本']}};
   return route.fulfill({json:data,headers:{'Access-Control-Allow-Origin':'*'}});
  });
  if(scenario==='uncertain'||scenario==='shared-nickname'||scenario==='draft-reload')
   await page.addInitScript(({spoken,seq})=>{
    const file={name:'test.mov',size:1234,lastModified:1000};
    localStorage.setItem('peakstamp_current_video_project_v1',JSON.stringify({version:1,projectId:'simple-test',files:[file],updatedAt:1000}));
    localStorage.setItem('peakstamp_confirmed_goals_v1:test.mov::1234::1000',
     JSON.stringify({source:file,items:[{id:'goal',origin:'manual',status:'confirmed',timeSeconds:20,scorer:spoken,assistStatus:'none',matchSeq:seq}]}));
   },scenario==='shared-nickname'?{spoken:'たいせい',seq:1}:{spoken:'Unknown',seq:3});
  await page.goto('https://peakstamp.local/');
  await page.fill('#ssBridgeToken','mock-token');await page.click('#ssLoadEvents');await page.click('#ssLoadSnapshot');
  await page.locator('#simpleSaveArea').waitFor({state:'visible'});
  assert.equal(await page.locator('.simple-match').count(),4);
  assert.equal(await page.locator('#workerBatchRun').isVisible(),false);
  assert.equal(await page.locator('#legacyBatchDetails').isVisible(),false);
  assert.equal(await page.locator('#simpleSave').isDisabled(),true);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal overflow');
  if(scenario==='new'||scenario==='partial'){
   const cards=page.locator('.simple-match');
   if(scenario==='new'){
    await cards.nth(0).getByRole('button',{name:'チーム1 勝ち',exact:true}).click();
    await cards.nth(1).getByRole('button',{name:'チーム3 勝ち',exact:true}).click();
   }
   assert.equal(await cards.nth(0).getByRole('button',{name:'引き分け',exact:true}).count(),0);
   await cards.nth(2).getByRole('button',{name:'チーム2 勝ち',exact:true}).click();
   assert.equal(await cards.nth(2).getByRole('button',{name:'チーム2 勝ち',exact:true}).getAttribute('aria-pressed'),'true');
   await cards.nth(3).getByRole('button',{name:'引き分け',exact:true}).click();
   assert.equal(await page.locator('#simpleSave').isEnabled(),true);
   if(scenario==='new'){
    await page.click('#simpleSave');await page.waitForFunction(()=>document.querySelector('#workerBatchStatus').textContent.includes('テスト用の停止'));
    assert.equal(posts.length,1);assert.equal(posts[0].path,'/staging/batch/start');
    assert.deepEqual(posts[0].body.operations.map(op=>op.winner),['left','left','left','draw']);
   }else{
    assert.match(await page.locator('#simpleSave').innerText(),/残り2試合/);
   }
  }
  if(scenario==='uncertain'){
   const scorer=page.getByLabel('ゴール 1 得点者');await scorer.selectOption('西村');
   assert.match(await page.locator('.simple-match').nth(2).locator('.simple-score').innerText(),/1 − 0/);
   assert.equal(await page.locator('.simple-match').nth(2).getByRole('button',{name:'チーム2 勝ち',exact:true}).count(),0);
   await page.getByRole('button',{name:'このゴールを除く',exact:true}).click();
   assert.match(await page.locator('.simple-match').nth(2).locator('.simple-score').innerText(),/0 − 0/);
   await page.getByRole('button',{name:'戻す',exact:true}).click();
   assert.match(await page.locator('.simple-match').nth(2).locator('.simple-score').innerText(),/1 − 0/);
  }
  if(scenario==='shared-nickname'){
   const menu=page.getByLabel('ゴール 1 得点者（本人を選択）');
   assert.equal(await menu.count(),1,'AI confidence must not hide a second shared-nickname identity');
   assert.equal(await menu.inputValue(),'','ambiguous goal must not preselect guessed player');
   const options=await menu.locator('option').allTextContents();
   assert.ok(options.some(x=>x.includes('たいせい　チーム1')));
   assert.ok(options.some(x=>x.includes('たいせいA　チーム2')));
   await menu.selectOption('たいせいA');
   const first=page.locator('.simple-match').first();
   assert.match(await first.locator('.simple-score').innerText(),/0 − 1/,
    'selecting other-side scorer must update the scoring team');
  }
  if(scenario==='draft-reload'){
   const scorer=page.getByLabel('ゴール 1 得点者');
   assert.match(await page.locator('.simple-match').nth(2).innerText(),/動画保存：Unknown/);
   await scorer.selectOption('西村');
   await page.reload();
   await page.fill('#ssBridgeToken','mock-token');
   await page.click('#ssLoadEvents');
   await page.click('#ssLoadSnapshot');
   await page.locator('#simpleSaveArea').waitFor({state:'visible'});
   assert.equal(await page.getByLabel('ゴール 1 得点者').inputValue(),'西村',
    'same official event and fixture restores the user-selected scorer');
   assert.match(await page.locator('.simple-match').nth(2).innerText(),/前回の選択を復元しました/);
   // Recreate the bracket: previous name may be displayed for the operator,
   // but must NOT be approved against a new official SS match ID.
   matches[2].match_id='33333333-3333-4333-8333-333333333333';
   await page.reload();
   await page.fill('#ssBridgeToken','mock-token');
   await page.click('#ssLoadEvents');
   await page.click('#ssLoadSnapshot');
   await page.locator('#simpleSaveArea').waitFor({state:'visible'});
   assert.equal(await page.getByLabel('ゴール 1 得点者').inputValue(),'');
   assert.match(await page.locator('.simple-match').nth(2).innerText(),/前回の選択：西村/);
  }
  if(scenario==='waiting'){
   assert.match(await page.locator('.simple-match').nth(2).innerText(),/準決勝の結果/);
   assert.equal(await page.locator('.simple-match').nth(2).getByRole('button').count(),0);
  }
  assert.deepEqual(errors,[],scenario+' has no JS errors');
  console.log('PASS simple results: '+scenario);
  await page.close();
 }
}finally{await browser.close()}
