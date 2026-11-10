import {restoreBridgeSession} from './sposched-bridge-session.mjs';
import {sampleIds,videoId,matchInfo,matchName,analysisResult,seconds,shortRange,selected} from './youtube-session.mjs';
import {judgeScene,undecided} from './review-flow.mjs';
import {makeManualGoal,validateGoal,saveGoalDrafts} from './goal-stats.mjs';
import {saveCurrentGoalProject} from './goal-project.mjs';
import {createEditTransfer} from './edit-transfer.mjs';

const storageKey='peakstamp-youtube-test-project-v1';
import peakStampPrompt from './youtube-ps-prompt.mjs';
import {estimateGoalTime} from './goal-stats.mjs';
function el(tag,text,cls){
 const node=document.createElement(tag);
 if(text!==undefined)node.textContent=text;
 if(cls)node.className=cls;
 return node;
}
function button(text,action){
 const b=el('button',text,'whisper-run');b.type='button';b.onclick=action;return b;
}
function input(label,value,change){
 const box=el('label',label+' '),field=el('input');
 box.style.cssText='display:grid;gap:4px;margin:10px 0';field.style.cssText='width:100%;box-sizing:border-box';field.value=value||'';field.onchange=()=>change(field.value.trim());box.append(field);return box;
}
function initialProject(){
 return {sources:[],editKey:Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join(''),published:''};
}
function goalSource(s,i){return {file:{name:'YouTube-'+s.id,size:0,lastModified:0},matchNumber:i+1};}
async function analyze(s,key,instruction,windowRange=null){
 if(!key)throw Error('Gemini APIキーを入力してください。');
 const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',{
  signal:AbortSignal.timeout(300000),method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},
  body:JSON.stringify({contents:[{parts:[{fileData:{fileUri:'https://www.youtube.com/watch?v='+s.id},...(windowRange?{videoMetadata:windowRange}:{})},{text:instruction}]}],generationConfig:{responseMimeType:'application/json'}})});
 if(!response.ok)throw Error('Gemini HTTP '+response.status+'。キー、割当量、公開設定を確認してください。');
 const body=await response.json();
 const parts=body.candidates?.[0]?.content?.parts||[];
 return JSON.parse(parts.filter(p=>!p.thought).map(p=>p.text||'').join(''));
}
async function analyzeMatch(s,key){
 const duration=s.duration||seconds((await analyze(s,key,'動画全体の長さのみを秒数で返す。JSON {"duration":数値}。')).duration);
 if(!(Number.isFinite(duration)&&duration>0))throw Error('動画長を確認できませんでした。');
 const raw=await analyze(s,key,peakStampPrompt(duration));
 if(!Array.isArray(raw.events)||!Array.isArray(raw.utterances))throw Error('PS形式の解析結果を取得できませんでした。');
 const labels={goal_reaction:'ゴールの反応',shot_reaction:'シュート',save_reaction:'好セーブ',excited_reaction:'好プレー'};
 const scenes=raw.events.filter(e=>e&&Number.isFinite(e.reaction_time_seconds)).map(e=>{
  const peak=e.reaction_time_seconds;
  return {peak,start:Math.max(0,peak-8),end:Math.min(duration,peak+4),quote:e.quote,label:labels[e.type]||'好プレー',goal:e.type==='goal_reaction'};
 });
 for(const u of raw.utterances.filter(u=>u?.kind==='goal_call'&&Number.isFinite(u.time_seconds)&&u.time_seconds>=0&&u.time_seconds<=duration&&u.quote)){
  const near=scenes.filter(c=>c.goal&&c.peak<=u.time_seconds+1&&u.time_seconds-c.peak<=15&&!c.callLinked)
   .sort((a,b)=>b.peak-a.peak)[0];
  const peak=estimateGoalTime(u.time_seconds);
  const clip=near||{peak,start:Math.max(0,peak-8),end:Math.min(duration,peak+4),label:'得点コール候補',goal:true};
  Object.assign(clip,{callLinked:true,quote:u.quote,scorer:u.scorer,assist:u.assist});
  if(!near)scenes.push(clip);
 }
 const match=raw.utterances.find(u=>u?.kind==='match_start');
 return {status:'ok',duration,teamA:match?.team_a,teamB:match?.team_b,scenes:scenes.sort((a,b)=>a.peak-b.peak)};
}
export function mountOrganizer({row,closePreview}){
 let project=JSON.parse(localStorage.getItem(storageKey)||'null')||initialProject();
 const originals=new Map(),settingsOpen=new Set(),activeScenes=new Map();
 let reviewingAll=false;
 const scenes=()=>project.sources.filter(s=>s.analyzed&&!s.info.drone)
  .flatMap(source=>source.candidates.map(item=>({source,item})));
 function showScene(source,item){
  activeScenes.set(source.id,item.id);
  render();
  const entry=[...$('matches').querySelectorAll('.highlight-entry')].find(e=>e.dataset.sourceId===source.id&&e.dataset.sceneId===String(item.id));
  entry?.querySelector('.play-btn')?.click();
  entry?.scrollIntoView({block:'start'});
 }
 function decide(item,decision){
  judgeScene(item,decision);
  save();
  const list=scenes(),at=list.findIndex(x=>x.item===item);
  const next=reviewingAll?list[at+1]:[...list.slice(at+1),...list.slice(0,at)].find(x=>undecided(x.item));
  if(next){showScene(next.source,next.item);return;}
  reviewingAll=false;
  render();
  const kept=list.filter(x=>x.item.enabled).length;
  const dialog=el('dialog');
  dialog.style.cssText='width:min(90vw,24rem);margin:auto;border:1px solid #466577;border-radius:16px;background:#12273a;color:white;padding:1.2rem';
  dialog.setAttribute('aria-label','候補の確認完了');
  const dismiss=()=>dialog.close();
  const review=button('最初から見直す',()=>{
   dismiss();reviewingAll=true;showScene(list[0].source,list[0].item);
  });
  dialog.append(el('h2','候補の確認が終わりました'),el('p',list.length+'件中 '+kept+'件をキープ'));
  if(kept&&selected(project.sources).some(c=>c.scorer))dialog.append(button('スポスケに登録（TEST）',()=>{dismiss();$('actions').closest('section').scrollIntoView({block:'start'});void startRegistration()}));
  if(kept)dialog.append(button('共有・出力へ',()=>{
   dismiss();$('access').closest('section').scrollIntoView({block:'start'});$('access').focus({preventScroll:true});
  }));
  dialog.append(review,button('閉じる',dismiss));
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  main.append(dialog);dialog.showModal();
 }
 const goalNotices=new Map();
 const main=el('main',undefined,'page');
 for(const child of document.body.children)if(child.tagName!=='SCRIPT')child.hidden=true;
 document.body.append(main);
 main.innerHTML='<h1>YouTubeハイライト TEST</h1><p><a href="./">ローカル動画モード</a></p><section class="panel"><h2>試合を追加</h2><textarea id="yt-urls" rows="4" placeholder="公開YouTube URL（複数行可）"></textarea><div id="yt-add"></div></section><section class="panel"><label>Gemini APIキー <input type="password" autocomplete="off" id="yt-key"></label><div id="yt-run"></div><p role="status" id="yt-status"></p></section><div id="yt-matches"></div><section class="panel"><h2>共有・出力</h2><label>PSアクセスコード（リンク発行用） <input type="password" autocomplete="off" id="yt-access"></label><div id="yt-actions"></div><p id="yt-result"></p></section>';
 const $=id=>main.querySelector('#yt-'+id);
 const keyField=$('key');
 const keyLabel=keyField.closest('label');
 keyLabel.style.display='grid';
 const rememberBox=el('label',' この端末にAPIキーを保存（個人端末用）');
 const remember=el('input');remember.type='checkbox';rememberBox.prepend(remember);keyLabel.after(rememberBox);
 const keyStore='peakstamp-yt-personal-key';
 try{keyField.value=localStorage.getItem(keyStore)||'';remember.checked=Boolean(keyField.value)}catch{}
 function rememberKey(){try{if(remember.checked&&keyField.value.trim())localStorage.setItem(keyStore,keyField.value.trim());else localStorage.removeItem(keyStore)}catch{remember.checked=false}}
 remember.onchange=rememberKey;keyField.onchange=rememberKey;
 const status=m=>{$('status').textContent=m;};
 if(new URLSearchParams(location.search).has('sample'))$('urls').value=sampleIds.map(id=>'https://youtu.be/'+id).join('\n');
 function save(){localStorage.setItem(storageKey,JSON.stringify(project));}
 let busy=false;
 async function run(task){
  if(busy)return;
  busy=true;main.setAttribute('aria-busy','true');
  try{await task()}catch(e){status(e.message)}finally{busy=false;main.removeAttribute('aria-busy');render()}
 }
 async function metadata(s){
  const r=await fetch('./api/yt-title?id='+s.id);
  if(!r.ok)throw Error('タイトル取得失敗。公開設定を確認して再取得してください。');
  const {title}=await r.json();s.title=title;
  const parsed=matchInfo(title);
  for(const k of Object.keys(parsed))if(!s.info[k])s.info[k]=parsed[k];
  s.metadataReady=true;s.error='';
 }
 async function add(){
  const values=$('urls').value.trim().split(/\s+/).filter(Boolean);
  const invalid=values.filter(v=>!videoId(v));
  for(const value of values){
   const id=videoId(value);
   if(!id||project.sources.some(s=>s.id===id))continue;
   const s={id,title:'',info:matchInfo(''),duration:0,candidates:[],metadataReady:false};project.sources.push(s);
   status('タイトルを取得中…');try{await metadata(s)}catch(e){s.error=e.message}save();render();
  }
  $('urls').value=invalid.join('\n');status(invalid.length?'YouTube URLを確認してください。':'登録済み '+project.sources.length+'本');
 }
 $('add').append(button('URLを登録',()=>run(add)),button('テスト4試合のURLを入力',()=>{$('urls').value=sampleIds.map(id=>'https://youtu.be/'+id).join('\n')}));
 async function scan(s){
  status(matchName(s)+' を解析中…');
  try{
   const result=await analyzeMatch(s,$('key').value.trim());
   const duration=seconds(result.duration);
   if(!(duration>0&&Number.isFinite(duration)))throw Error('動画長を取得できませんでした。');
   const report={};
   const candidates=analysisResult(result,{...s,duration},report);
   for(const k of ['teamA','teamB'])if(!s.info[k]&&typeof result[k]==='string')s.info[k]=result[k];
   Object.assign(s,{duration,candidates,analyzed:true,error:report.invalid?'時刻が不正な'+report.invalid+'件を除き、有効な候補を保存しました。':''});
  }catch(e){s.error=e.message}
  save();render();
 }
 $('run').append(button('未解析の試合を順に解析',()=>run(async()=>{
  if(!$('key').value.trim())throw Error('Gemini APIキーを入力してください。');
  for(const s of project.sources)if(s.metadataReady&&!s.info.drone&&!s.analyzed)await scan(s);
  status('解析処理が終了しました。各試合の候補とエラーを確認してください。');
 })));
 async function findGoals(s){
  status(matchName(s)+' のPS基準で再解析中…');
  const result=await analyzeMatch(s,$('key').value.trim());
  const found=analysisResult(result,s);
  let added=0;
  for(const c of found){
   if(s.candidates.some(old=>Math.abs(old.peakSeconds-c.peakSeconds)<=3))continue;
   if(s.candidates.some(old=>old.rejected&&Math.abs(old.peakSeconds-c.peakSeconds)<=3))continue;
   c.id=crypto.randomUUID();s.candidates.push(c);added++;save();
  }
  s.candidates.sort((a,b)=>a.peakSeconds-b.peakSeconds);save();
  return added;
 }
 function syncGoals(){
  const matches=project.sources.filter(s=>!s.info.drone);
  matches.forEach((s,i)=>{
   const goals=s.candidates.filter(c=>c.goal).map(c=>({...c.goal,matchSeq:String(i+1),teamA:s.info.teamA,teamB:s.info.teamB,matchLabel:matchName(s)}));
   if(!saveGoalDrafts(goalSource(s,i),localStorage,goals))throw Error('ゴール情報を保存できませんでした。');
  });
  return matches.map(goalSource);
 }
 function goalEditor(s,c){
  const caption=()=>{
   const goal=c.goal;
   if(goal?.status!=='confirmed')return c.goalHint||goal?'ゴール候補を確認':'ゴールとして記録';
   const assist=goal.assistStatus==='none'?'なし':goal.assist?.trim()||'未確認';
   return '⚽ ゴール '+goal.scorer+' ／ アシスト '+assist;
  };
  const trigger=button(caption(),()=>{
   const dialog=el('dialog',undefined,'yt-goal-dialog');
   dialog.setAttribute('aria-label','ゴール記録');
   const heading=el('h2','ゴール記録');
   const g=c.goal||{...makeManualGoal(c.peakSeconds,goalSource(s,0),localStorage),id:'yt-'+c.id,scorer:c.scorerHint,assist:c.assistHint,assistStatus:c.assistHint?'named':'unknown'};
   function edit(k,v){g[k]=v;g.status='draft';g.confirmedAt=null;c.goal=g;save();syncGoals()}
   const assist=input('アシスト',g.assist,v=>{edit('assist',v);edit('assistStatus',v?'named':'unknown')});
   const errorNote=el('p');errorNote.setAttribute('role','alert');
   const confirmGoal=button('ゴール確定',()=>{
    const error=validateGoal(g);if(error){errorNote.textContent=error;return}
    Object.assign(g,{status:'confirmed',confirmedAt:new Date().toISOString(),goalTimeVerified:true});c.goal=g;save();syncGoals();dialog.close();
   });
   dialog.append(heading,input('得点者',g.scorer,v=>edit('scorer',v)),assist,button('アシストなし',()=>{
    edit('assist','');edit('assistStatus','none');assist.querySelector('input').value='';errorNote.textContent='アシストなし';
   }),errorNote,confirmGoal);
   if(c.goal||c.goalHint)dialog.append(button('ゴール記録を外す',()=>{delete c.goal;c.goalHint=false;save();syncGoals();dialog.close()}));
   dialog.append(button('閉じる',()=>dialog.close()));
   dialog.addEventListener('close',()=>{dialog.remove();trigger.textContent=caption();trigger.focus({preventScroll:true})},{once:true});
   main.append(dialog);dialog.showModal();
  });
  trigger.classList.add('yt-goal-action');
  return trigger;
 }
 function render(){
  closePreview();
  const root=$('matches');root.replaceChildren();
  project.sources.forEach((s,i)=>{
   const card=el('section',undefined,'panel');root.append(card);
   const heading=el('h2',matchName(s));
   heading.style.cssText='margin:0 0 .35em;font-size:1.1rem';
   card.append(heading);
   const settings=el('details');
   settings.open=settingsOpen.has(s.id);
   settings.ontoggle=()=>{if(settings.isConnected){if(settings.open)settingsOpen.add(s.id);else settingsOpen.delete(s.id)}};
   settings.append(el('summary','試合設定'),el('small',s.title||s.id));
   card.append(settings);
   if(s.error)card.append(el('p',s.error));
   if(!s.metadataReady)card.append(button('タイトルを再取得',()=>run(async()=>{await metadata(s);save()})));
   for(const [k,name] of Object.entries({date:'開催日',round:'区分',teamA:'対戦カードの左側',teamB:'対戦カードの右側'}))settings.append(input(name,s.info[k],v=>{s.info[k]=v;save();render()}));
   const move=delta=>{if(busy)return;const next=i+delta;if(next<0||next>=project.sources.length)return;project.sources.splice(next,0,project.sources.splice(i,1)[0]);save();render()};
   const order=el('div');order.style.cssText='display:flex;gap:.5rem';
   const up=button('順番を上へ',()=>move(-1)),down=button('順番を下へ',()=>move(1));
   up.disabled=i===0;down.disabled=i===project.sources.length-1;
   order.append(up,down);settings.append(order);
   if(s.info.drone){card.append(el('p','Drone · 解析対象外'));return}
   if(!s.analyzed&&s.metadataReady)card.append(button('この試合を解析',()=>run(()=>scan(s))));
   if(!s.analyzed)return;
   const notice=el('p',goalNotices.get(s.id)||'');
   notice.setAttribute('role','status');
   notice.hidden=!notice.textContent;
   const say=message=>{goalNotices.set(s.id,message);notice.textContent=message;notice.hidden=false};
   const rescan=button('PS基準で再解析',()=>{
    if(busy){say('別の解析が進行中です。終了後に押してください。');return}
    if(!$('key').value.trim()){
     say('画面上部にGemini APIキーを入力してから、もう一度押してください。');
     $('key').focus();status('ゴール再検索にはGemini APIキーを入力してください。');return;
    }
    rescan.disabled=true;rescan.textContent='PS基準で再解析中…';
    say('Geminiがこの試合の掛け声・得点コールを解析しています…');
    void run(async()=>{
     try{
      const added=await findGoals(s);
      say(added?'新しい候補を'+added+'件追加しました。':'新しく追加できる候補は0件でした。');
     }catch(e){say(e.name==='TimeoutError'?'接続がタイムアウトしました。もう一度お試しください。':'再検索できませんでした。'+e.message)}
    });
   });
   settings.append(rescan);card.append(notice);
   const count=s.candidates.length;
   if(!count){card.append(el('p','候補はありません'));return;}
   const current=s.candidates.find(c=>c.id===activeScenes.get(s.id))||s.candidates.find(undecided)||s.candidates[0];
   const n=s.candidates.indexOf(current);
   const nav=el('div');nav.style.cssText='display:flex;align-items:center;gap:.4rem;margin:.65rem 0';
   const jump=offset=>{reviewingAll=false;showScene(s,s.candidates[n+offset])};
   const prev=button('‹',()=>jump(-1)),next=button('›',()=>jump(1));
   prev.setAttribute('aria-label','前の候補');next.setAttribute('aria-label','次の候補');
   prev.disabled=n===0;next.disabled=n===count-1;
   for(const b of [prev,next])b.style.cssText='width:44px;min-height:44px;margin:0';
   const position=el('strong','動画編集　'+(n+1)+' / '+count);
   position.style.marginRight='auto';
   nav.append(position,prev,next);card.append(nav);
   {
    const c=current;
    const transcript=el('p',undefined,'yt-transcript');
    function showTranscript(){
     const checked=c.audioCheck;
     transcript.textContent=checked?.text&&checked.start===c.time&&checked.end===c.manualEnd
      ?checked.text:c.geminiQuote?'AI聞き取り（推定）「'+c.geminiQuote+'」':'聞き取りなし';
    }
    showTranscript();
    const entry=row(c,n,{source:s,save:()=>{save();showTranscript()},decide});
    entry.querySelector('.item-fields').append(transcript);
    const score=entry.querySelector('.score');
    if(score){
     score.textContent='プレー推定 '+Math.floor(c.peakSeconds/60)+':'+String(Math.floor(c.peakSeconds%60)).padStart(2,'0');
     score.title='';
    }
    if(c.manualEnd-c.time>12)entry.append(button('ピーク前後に短縮',()=>{
     const range=shortRange(c.time,c.manualEnd,c.peakSeconds);
     c.time=range.start;c.manualEnd=range.end;save();render();
    }));
    entry.append(goalEditor(s,c));card.append(entry);
   }
   const label=el('label','HS用の携帯原本（任意） '),file=el('input');file.type='file';file.accept='video/*,.mov,.mp4';
   file.onchange=()=>{if(file.files[0])originals.set(s.id,file.files[0])};label.append(file);settings.append(label);
  });
  const result=$('result');result.replaceChildren();
  if(project.published){
   const a=el('a','共有ページを開く');a.href=project.published;a.target='_blank';result.append(a,button('URLをコピー',async()=>{try{await navigator.clipboard.writeText(a.href);status('コピーしました。')}catch{window.prompt('共有URL',a.href)}}));
  }
 }
 async function publishHighlights(){
  const clips=selected(project.sources);
  if(!clips.length)throw Error('まず場面をキープしてください。');
  const r=await fetch('./api/yt-share',{method:'POST',headers:{'Content-Type':'application/json','X-Edit-Key':project.editKey,'X-PeakStamp-Access':$('access').value},body:JSON.stringify({clips})});
  const body=await r.json();
  if(!r.ok)throw Error(body.error||'発行失敗');
  project.published=new URL('./youtube-watch.html?id='+body.id,location.href).href;
  save();status('共有リンクを発行しました。');
  return project.published;
 }
 async function registerVideos(){
  const sources=project.sources.filter(s=>!s.info.drone);
  const dates=new Set(sources.map(s=>s.info.date));
  if(!sources.length||dates.size!==1||!sources[0].info.date)throw Error('同じ開催日の試合を選んでください。');
  if(!selected(sources).some(c=>c.scorer&&c.label==='⚽ ゴール'))throw Error('採用するゴールを確定してください。');
  const token=$('bridge').value.trim()||restoreBridgeSession(sessionStorage,'staging');
  if(!token){$('bridge').focus();throw Error('スポスケTEST接続コードを入力してください。')}
  const api=async(path,body)=>{
   const headers={'X-SS-Bridge-Token':token};
   if(body)headers['Content-Type']='application/json';
   const res=await fetch('https://shoot-sunday-sync-staging.yomax1979.workers.dev'+path,{signal:AbortSignal.timeout(45000),method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});
   if(res.status===401)throw Error('スポスケTEST接続コードを確認してください。');
   const data=await res.json();
   if(!res.ok)throw Error(data.error?.message||data.error||'TEST HTTP '+res.status);
   return data;
  };
  const fixtureVideos=['-sEOeqqTyuw','ey1_5PaMvBo','Ngp_ilKW91E','9zA4YCs8Ass'];
  const demo=sources[0].info.date==='2026-11-08'&&sources.length===4&&fixtureVideos.every(id=>sources.some(s=>s.id===id));
  const date=demo?'2026-11-10':sources[0].info.date;
  progress.textContent=date+' のイベントを照合中…';
  const events=(await api('/events?from='+date+'&to='+date)).events.filter(e=>e.date===date&&(!demo||e.name.replace(/\s/g,'')==='日曜定期(10Nov)'));
  if(events.length!==1)throw Error('登録先イベントを特定できません。');
  const event=events[0],data=await api('/video-registration/inspect?event_id='+encodeURIComponent(event.event_id));
  if(data.environment!=='TEST'||data.event.event_id!==event.event_id||data.videos.event_id!==event.event_id)throw Error('TESTイベントが一致しません。');
  progress.textContent='ゴール集の共有リンクを準備中…';
  const reelUrl=new URL(await publishHighlights());reelUrl.searchParams.set('goals','1');
  const results=el('ul');summary.append(el('strong',event.name),results);
  const team=value=>Number(String(value).normalize('NFKC').match(/^(?:チーム|Team|T)?\s*(\d+)$/i)?.[1]);
  const targets=sources.map(s=>{
   const left=team(s.info.teamA),right=team(s.info.teamB);
   const matches=data.matches.matches.filter(m=>m.event_id===event.event_id&&m.left?.team===left&&m.right?.team===right&&(!demo||m.number===fixtureVideos.indexOf(s.id)+1));
   return {name:matchName(s),kind:'match',match:matches.length===1?matches[0]:null,url:'https://youtu.be/'+s.id};
  });
  targets.push({name:'ゴール集',kind:'goal_reel',match:null,url:reelUrl.href});
  const states={registered:'登録・照合済み',already_registered:'登録済み',conflict:'別URLあり',pending:'結果未確定'};
  let completed=0;
  for(const [i,t] of targets.entries()){
   progress.textContent=(i+1)+' / '+targets.length+' 件目を照合中…';
   const line=el('li',t.name+'　照合中');results.append(line);
   try{
    const slots=data.videos.videos.filter(v=>v.event_id===event.event_id&&v.kind===t.kind&&(t.kind==='goal_reel'?v.match_id===null:t.match&&v.match_id===t.match.match_id&&v.number===t.match.number));
    if(slots.length!==1)throw Error('枠を特定できません');
    const payload={event_id:event.event_id,event_date:event.date,event_name:event.name,kind:t.kind,video_id:slots[0].video_id,match_id:t.match?.match_id,number:t.match?.number,left:t.match?.left.team,right:t.match?.right.team,video_url:t.url};
    let answer=await api('/staging/video-slot',payload);
    if(answer.status==='ready')answer=await api('/staging/video-slot',{...payload,confirm:'TEST VIDEO REGISTER'});
    if(['registered','already_registered'].includes(answer.status))completed++;
    line.textContent=t.name+'　'+(states[answer.status]||'要確認')+(answer.existing_url?'　'+answer.existing_url:'');
   }catch(e){line.textContent=t.name+'　'+e.message}
  }
  progress.textContent='登録済み '+completed+' / '+targets.length+'件'+(completed===targets.length?'':'（要確認 '+(targets.length-completed)+'件）');
 }
 const bridgeLabel=el('label','スポスケTEST接続コード');
 const bridge=el('input');bridge.type='password';bridge.id='yt-bridge';bridge.autocomplete='off';bridgeLabel.append(bridge);
 const summary=el('div');summary.id='yt-registration-results';summary.setAttribute('role','status');
 const progress=el('p');
 const registerButton=button('スポスケに登録（TEST）',startRegistration);
 async function startRegistration(){
  if(registerButton.disabled)return;
  summary.replaceChildren(progress);
  if(busy){progress.textContent='別の処理が進行中です。終了後にもう一度押してください。';return;}
  progress.textContent='登録内容を確認中…';
  registerButton.disabled=true;registerButton.textContent='登録処理中…';
  try{await run(async()=>{
   try{await registerVideos()}catch(e){progress.textContent=e.message||'登録できませんでした。';}
  })}finally{registerButton.disabled=false;registerButton.textContent='スポスケに登録（TEST）';}
 }
 $('actions').before(bridgeLabel);
 $('actions').append(button('全試合の共有リンクを発行・更新',()=>run(publishHighlights)),
  registerButton,summary,
  button('HS用JSON',()=>run(async()=>{
  const clips=selected(project.sources),sources=[];
  for(const s of project.sources.filter(s=>clips.some(c=>c.video===s.id))){
   const file=originals.get(s.id);if(!file)throw Error(matchName(s)+' の携帯原本を選んでください。端末内で照合します。');
   const url=URL.createObjectURL(file),video=document.createElement('video');
   try{
    video.preload='metadata';
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('原本の読み込みがタイムアウトしました。')),20000);video.onloadedmetadata=()=>{clearTimeout(timer);resolve()};video.onerror=()=>{clearTimeout(timer);reject(Error('原本を読み込めません。'))};video.src=url});
    if(Math.abs(video.duration-s.duration)>2)throw Error(matchName(s)+' の動画長が一致しません。YouTubeと同じ開始位置・長さの原本を指定してください。');
    sources.push({...s,file,duration:video.duration});
   }finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url)}
  }
  const data=createEditTransfer(sources,clips.map(c=>({sourceId:c.video,start:c.start,end:c.end})));
  data.clips.forEach((c,i)=>{const x=clips[i];c.title=[x.label,x.scorer,x.assist&&'アシスト '+x.assist].filter(Boolean).join(' ')});
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=el('a');a.href=url;a.download='PeakStamp-YouTube-HS.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
 })),button('確定ゴールをスポスケTESTで確認',()=>{
  const sources=syncGoals();
  const session=saveCurrentGoalProject(localStorage,sources,{newProject:true});
  session.projectId='youtube-'+project.sources.filter(s=>!s.info.drone).map(s=>s.id).sort().join('.');
  localStorage.setItem('peakstamp_current_video_project_v1',JSON.stringify(session));
  location.href='./sposched-review.html?returnTab=1';
 }),button('新しい開催を開始',()=>{
  if(busy||!confirm('新しい開催に切り替えます。現在の下書きと共有リンクの更新権限はこの端末から消去されます。'))return;
  project=initialProject();originals.clear();settingsOpen.clear();activeScenes.clear();reviewingAll=false;save();render();
 }));
 render();
}
