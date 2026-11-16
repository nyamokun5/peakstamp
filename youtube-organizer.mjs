import {publishMirror} from './youtube-mirror.mjs?v=short1';
import {createGeminiProgressUI} from './gemini-progress-ui.mjs';
import {youtubeApi,youtubeWorker,youtubeTestMode,youtubeEnvironment} from './youtube-api.mjs';
import {registrationEvents,resolveRegistrationMatch} from './youtube-video-registration.mjs?v=event-match3';
import {restoreBridgeSession} from './sposched-bridge-session.mjs';
import {sampleIds,videoId,matchInfo,matchName} from './youtube-session.mjs';
import {hydrateYouTubeSource,storeYouTubeAnalysis,selectedYouTubeClips,confirmedYouTubePair,youtubeDisplayName} from './youtube-shared-project.mjs?v=focus1';
import {initGeminiAccess} from './gemini-access.mjs?v=youtube-unified1';
import {createEditTransfer} from './edit-transfer.mjs';
const storageKey=youtubeTestMode?'peakstamp-youtube-test-project-v1':'peakstamp-youtube-production-project-v1';
const endpoint=(youtubeTestMode?'https://peakstamp-gemini-api-git-staging-team-opt.vercel.app':'https://peakstamp-gemini-api.vercel.app')+'/api/gemini-youtube';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
const button=(text,action)=>{const b=el('button',text,'whisper-run');b.type='button';b.onclick=action;return b};
const initialProject=()=>({sources:[],editKey:Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join(''),published:''});
export function mountOrganizer({state,syncSources,ssNames,analysisCompleted,workflow}){
 const get=id=>document.getElementById(id);
 let project;try{project=JSON.parse(localStorage.getItem(storageKey)||'null')}catch{}
 project=project&&Array.isArray(project.sources)?project:initialProject();
 const originals=new Map();let busy=false,controller=null;
 state.sources=project.sources.filter(s=>videoId('https://youtu.be/'+s.id)).map((s,i)=>hydrateYouTubeSource(s,i,localStorage));
 project.sources=state.sources;
 const selected=sources=>selectedYouTubeClips(sources,localStorage);
 const save=()=>{project.sources=state.sources;localStorage.setItem(storageKey,JSON.stringify(project,(k,v)=>['mediaFile','mediaObjectUrl'].includes(k)?undefined:v))};
 document.body.dataset.sourceMode='youtube';
 const heading=get('choosePanel').querySelector('h2');heading.textContent='試合動画を登録';
 document.querySelector('.local-pill').textContent='YouTube';
 const link=document.querySelector('a[href="?youtube=1"]');link.href='./';link.textContent='ローカル動画からハイライトを作る';
 const urls=el('textarea');urls.id='yt-urls';urls.rows=4;urls.placeholder='公開YouTube URL（複数行可）';urls.setAttribute('aria-label','YouTube URL');
 const sourceControls=el('div',undefined,'youtube-source-controls');sourceControls.append(urls,button('URLを登録',()=>run(add)));
 get('uploadZone').before(sourceControls);
 const progressUI=createGeminiProgressUI();
 const statusNode=get('geminiMainStatus');
 const status=message=>{statusNode.textContent=message;statusNode.hidden=false};
 const access=get('geminiMainAccess');initGeminiAccess(access,get('geminiRememberDevice'));
 get('geminiPrimaryPanel').hidden=false;
 get('geminiPrimaryPanel').querySelector('.gemini-brief').textContent='ゴール・見どころ・選手名をまとめて検出。動画で確認してからキープします。';
 const consent=get('geminiMainConsent');consent.closest('label').lastChild.textContent=' 公開YouTube動画をAIに送信して解析することに同意します';
 const single=get('geminiMainRun'),batch=get('geminiMainBatch'),picker=get('geminiMainSource');
 single.textContent='この動画を解析する →';batch.textContent='選んだ動画をまとめて解析 →';
 const cancel=get('geminiMainCancel');cancel.onclick=()=>controller?.abort();
 function refresh(){
  get('geminiPrimaryPanel').hidden=!state.sources.length;
  get('geminiStayNotice').hidden=!state.sources.length;
  get('geminiStayTitle').textContent='解析中はこの画面を開いたままにしてください';
  const current=picker.value;picker.replaceChildren(...state.sources.map(s=>{const o=el('option',matchName(s));o.value=s.id;return o}));picker.value=state.sources.some(s=>s.id===current)?current:state.sources[0]?.id||'';
  picker.disabled=busy||!state.sources.length;single.disabled=batch.disabled=busy||!state.sources.length;
  single.hidden=true;batch.hidden=!state.sources.length;batch.textContent=busy?'まとめて解析中…':'全'+state.sources.length+'本をまとめて解析 →';picker.hidden=true;get('geminiSourceLabel').hidden=true;cancel.hidden=!busy;
  get('geminiMainFileHelp').textContent=state.sources.length?'解析済みの動画は保存した結果を再利用します。':'公開YouTube URLを登録してください。';
  get('montagePanel').hidden=!selected(state.sources).length;
  originalInputs.replaceChildren(...state.sources.map(s=>{const label=el('label',matchName(s)+'：MP4用の元動画（任意） '),file=el('input');file.type='file';file.accept='video/*,.mov,.mp4';file.onchange=async()=>{const chosen=file.files[0];if(!chosen)return;const v=document.createElement('video'),url=URL.createObjectURL(chosen);try{v.preload='metadata';await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('元動画の読み込みがタイムアウトしました。')),20000);v.onloadedmetadata=()=>{clearTimeout(t);resolve()};v.onerror=()=>{clearTimeout(t);reject(Error('元動画を読み込めません。'))};v.src=url});if(Math.abs(v.duration-s.duration)>2)throw Error('YouTubeと同じ長さ・開始位置の元動画を指定してください。');originals.set(s.id,chosen);if(s.mediaObjectUrl)URL.revokeObjectURL(s.mediaObjectUrl);s.mediaFile=chosen;s.mediaObjectUrl=URL.createObjectURL(chosen);syncSources();status('元動画を選択しました。上の共通ボタンからMP4を書き出せます。');}catch(e){status(e.message)}finally{v.removeAttribute('src');v.load();URL.revokeObjectURL(url)}};label.append(file);if(s.mediaFile)label.append(el('small',s.mediaFile.name+' を選択済み'));return label}));
  result.replaceChildren();
  if(project.published&&project.publishedPayload===JSON.stringify(selected(state.sources))){const a=el('a','共有ページを開く');a.href=project.published;a.target='_blank';a.rel='noopener';result.append(a,button('短いリンクをコピー',async()=>{await navigator.clipboard.writeText(a.href);status('コピーしました。')}))}
 }
 async function run(task){if(busy)return;busy=true;state.geminiProcessing=true;controller=new AbortController();refresh();
  try{await task()}catch(e){status(e.name==='AbortError'?'解析を中止しました。保存済みの結果は再利用できます。':e.message)}
  finally{busy=false;state.geminiProcessing=false;controller=null;save();syncSources();refresh()}}
 async function metadata(s){const r=await fetch(youtubeApi('title')+'?id='+s.id);if(!r.ok)throw Error('タイトル取得失敗。公開設定を確認してください。');const {title}=await r.json();s.title=title;s.info={...matchInfo(title),...Object.fromEntries(Object.entries(s.info).filter(([,v])=>v))};s.metadataReady=true;s.error=''}
 async function add(){const values=urls.value.trim().split(/\s+/).filter(Boolean),invalid=[];
  for(const value of values){const id=videoId(value);if(!id){invalid.push(value);continue}if(state.sources.some(s=>s.id===id))continue;
   const s=hydrateYouTubeSource({id,title:'',info:matchInfo(''),duration:0,candidates:[],metadataReady:false},state.sources.length,localStorage);state.sources.push(s);
   status('タイトルを取得中…');try{await metadata(s)}catch(e){s.error=e.message}save();syncSources();refresh();}
  urls.value=invalid.join('\n');status(invalid.length?'YouTube URLを確認してください。':'登録済み '+state.sources.length+'本');}
 async function api(s,mode){const r=await fetch(endpoint,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','X-PeakStamp-Access':access.value.trim()},body:JSON.stringify({videoId:s.id,mode,...(mode==='highlights'?{durationSeconds:s.duration}:{})})});
  let data;try{data=await r.json()}catch{}
  if(!r.ok)throw Error(data?.error||'解析サーバーの応答を確認できませんでした。HTTP '+r.status);return data;}
 async function scan(s,force=false){if(s.analyzed&&!force)return;
  status(matchName(s)+' を解析中…');
  try{if(!(s.duration>0)){s.duration=Number((await api(s,'duration')).duration);save()}
   if(!(s.duration>0&&s.duration<=1800))throw Error('解析できる動画は30分以内です。');
   const parsed=await api(s,'highlights');storeYouTubeAnalysis(s,parsed,localStorage);save();await ssNames.refresh();syncSources();
  }catch(e){s.error=e.message;save();throw e}}
 async function analyze(list,force=false){
  if(!access.value.trim()){access.focus();throw Error('アクセスコードを入力してください。')}
  if(!consent.checked){consent.focus();throw Error('動画送信への同意をチェックしてください。')}
  const targets=list.filter(s=>!s.info.drone);if(!targets.length)throw Error('解析する動画を登録してください。');
  const failures=[];let success=0;progressUI.start();
  for(const [i,s] of targets.entries()){
   if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
   status((i+1)+' / '+targets.length+' 本目を解析中…');
   try{await scan(s,force);success++;progressUI.segments(i+1,targets.length);get('geminiProgressLabel').textContent='動画を解析中 · '+(i+1)+' / '+targets.length+' 本';}catch(e){if(controller.signal.aborted)throw e;failures.push(e.message);if(/アクセスコード|認証|401|403/.test(e.message))break}
  }
  status(failures.length?'解析できない動画があります：'+failures.join(' ／ '):'解析が完了しました。動画で確認してからキープしてください。');
  if(failures.length)progressUI.fail('解析できない動画があります');else progressUI.complete();
  analysisCompleted({success:success>0,failures:failures.length,error:failures[0]||''});
 }
 single.onclick=()=>run(()=>analyze(state.sources.filter(s=>s.id===picker.value)));batch.onclick=()=>run(()=>analyze(state.sources));
 const advanced=get('geminiAdvancedTools');
 const advancedSummary=el('summary','詳細設定・再解析・接続診断');
 const check=button('接続を確認',()=>run(async()=>{const r=await fetch(endpoint);const data=await r.json();if(!r.ok||data.service!=='peakstamp-gemini-youtube')throw Error('解析サーバーへの接続を確認できませんでした。');status('解析サーバーへの接続を確認しました。');}));
 const rescan=button('Geminiで再解析',()=>{if(busy||!state.sources.length)return;if(!confirm('保存済みの結果を使わず再解析します。追加料金が発生する場合があります。続けますか？'))return;void run(()=>analyze(state.sources,true));});
 const localAdvanced=el('div');localAdvanced.hidden=true;localAdvanced.append(...advanced.children);
 advanced.append(advancedSummary,el('p','通常の解析は保存済みの結果を再利用します。再解析は追加料金が発生する場合があります。','fine-print'),check,rescan,localAdvanced);

 get('choosePanel').querySelector('details:last-of-type').classList.add('local-file-help');
 if(new URLSearchParams(location.search).has('sample'))urls.value=sampleIds.map(id=>'https://youtu.be/'+id).join('\n');
 const exportRoot=el('div',undefined,'youtube-output');exportRoot.id='youtubeOutput';
 exportRoot.append(el('h3','YouTube共有リンク'),el('p','YouTubeの切り取り範囲は共有リンクで再生できます。MP4を書き出す場合は同じ元動画を指定してください。'));
 const originalInputs=el('div');exportRoot.append(originalInputs);
 const actions=el('div');actions.id='yt-actions';const result=el('p');result.id='yt-result';
 exportRoot.append(actions,result);get('montagePanel').append(exportRoot);
 const $=id=>id==='access'?access:id==='bridge'?get('ssAnalysisToken'):id==='actions'?actions:id==='result'?result:get('yt-'+id);
 async function publishHighlights(){
  const clips=selected(project.sources);
  if(!clips.length)throw Error('まず場面をキープしてください。');
  project.shareJobs=project.shareJobs||{};
  const job=await publishMirror({clips,access:$('access').value.trim(),record:{jobs:project.shareJobs},save,endpoint:youtubeApi('share'),requireContract:!youtubeTestMode});
  project.published=new URL('./youtube-watch.html?id='+job.id,location.href).href;project.publishedPayload=JSON.stringify(clips);
  save();status('共有リンクを発行しました。');
  return project.published;
 }
 async function registerVideos(){
  const sources=project.sources.filter(s=>!s.info.drone);
  const dates=new Set(sources.map(s=>s.info.date));
  if(!sources.length||dates.size!==1||!sources[0].info.date)throw Error('同じ開催日の試合を選んでください。');
  if(!selected(sources).some(c=>c.scorer&&c.label==='⚽ ゴール'))throw Error('採用するゴールを確定してください。');
  const token=$('bridge').value.trim()||restoreBridgeSession(sessionStorage,youtubeEnvironment);
  if(!token){$('bridge').focus();throw Error('スポスケ接続コードを入力してください。')}
  const api=async(path,body)=>{
   const headers={'X-SS-Bridge-Token':token};
   if(body)headers['Content-Type']='application/json';
   const res=await fetch(youtubeWorker+path,{signal:AbortSignal.timeout(45000),method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});
   if(res.status===401)throw Error('スポスケ接続コードを確認してください。');
   const data=await res.json();
   if(!res.ok)throw Error(data.error?.message||data.error||'SS HTTP '+res.status);
   return data;
  };
  const fixtureVideos=['-sEOeqqTyuw','ey1_5PaMvBo','Ngp_ilKW91E','9zA4YCs8Ass'];
  const demo=youtubeTestMode&&sources[0].info.date==='2026-11-08'&&sources.length===4&&fixtureVideos.every(id=>sources.some(s=>s.id===id));
  const date=sources[0].info.date;
  progress.textContent=date+' のイベントを照合中…';
  const available=(await api('/events?from='+date+'&to='+date+'&limit=100')).events;
  if(!Array.isArray(available))throw Error('イベント一覧の応答形式を確認できません。');
  const events=registrationEvents(available,date,demo);
  if(events.length!==1){
   const names=available.map(e=>String(e.date||'')+' '+String(e.name||'')).join(' ／ ');
   throw Error((events.length>1?'同名の登録先が複数あります。':'登録先 '+date+' が見つかりません。')+'取得したイベント：'+(names||'0件'));
  }
  const event=events[0],data=await api('/video-registration/inspect?event_id='+encodeURIComponent(event.event_id));
  if(data.environment!==(youtubeTestMode?'TEST':'PRODUCTION')||data.event.event_id!==event.event_id||data.videos.event_id!==event.event_id)throw Error('イベントが一致しません。');
  for(const s of sources)if(!confirmedYouTubePair(s,localStorage))throw Error('第'+s.matchNumber+'試合の対戦カードを確認してください。');
  progress.textContent='ゴール集の共有リンクを準備中…';
  const reelUrl=new URL(await publishHighlights());reelUrl.searchParams.set('goals','1');
  const results=el('ul');summary.append(el('strong',event.date+' '+event.name+''),results);
  const team=value=>Number(String(value).normalize('NFKC').match(/^(?:チーム|Team|T)?\s*(\d+)$/i)?.[1]);
  const targets=sources.map(s=>{
   const pairing=confirmedYouTubePair(s,localStorage);
   if(!pairing)throw Error('第'+s.matchNumber+'試合の対戦カードを確認してください。');
   const left=team(pairing.teamA),right=team(pairing.teamB);
   const resolved=resolveRegistrationMatch(data.matches.matches,event.event_id,left,right,demo?fixtureVideos.indexOf(s.id)+1:null);
   return {name:youtubeDisplayName(s,localStorage),kind:'match',match:resolved.match||null,error:resolved.error,url:'https://youtu.be/'+s.id};
  });
  targets.push({name:'ゴール集',kind:'goal_reel',match:null,url:reelUrl.href});
  const states={registered:'登録・照合済み',already_registered:'登録済み',conflict:'別URLあり',pending:'結果未確定'};
  let completed=0;
  for(const [i,t] of targets.entries()){
   progress.textContent=(i+1)+' / '+targets.length+' 件目を照合中…';
   const line=el('li',t.name+'　照合中');results.append(line);
   try{
    if(t.error)throw Error(t.error);
    const slots=data.videos.videos.filter(v=>v.event_id===event.event_id&&v.kind===t.kind&&(t.kind==='goal_reel'?v.match_id===null:t.match&&v.match_id===t.match.match_id&&v.number===t.match.number));
    if(slots.length!==1)throw Error('枠を特定できません');
    const payload={event_id:event.event_id,event_date:event.date,event_name:event.name,kind:t.kind,video_id:slots[0].video_id,match_id:t.match?.match_id,number:t.match?.number,left:t.match?.left.team,right:t.match?.right.team,video_url:t.url};
    let answer=await api('/'+youtubeEnvironment+'/video-slot',payload);
    if(answer.status==='ready')answer=await api('/'+youtubeEnvironment+'/video-slot',{...payload,confirm:youtubeTestMode?'TEST VIDEO REGISTER':'PRODUCTION VIDEO REGISTER'});
    if(['registered','already_registered'].includes(answer.status))completed++;
    line.textContent=t.name+'　'+(states[answer.status]||'要確認')+(answer.existing_url?'　'+answer.existing_url:'');
   }catch(e){line.textContent=t.name+'　'+e.message}
  }
  progress.textContent='登録済み '+completed+' / '+targets.length+'件'+(completed===targets.length?'':'（要確認 '+(targets.length-completed)+'件）');
 }
 const summary=el('div');summary.id='yt-registration-results';summary.setAttribute('role','status');
 const progress=el('p');
 const registerButton=button('試合動画・共有リンクをSSに登録',startRegistration);
 async function startRegistration(){
  if(registerButton.disabled)return;
  summary.replaceChildren(progress);
  if(busy){progress.textContent='別の処理が進行中です。終了後にもう一度押してください。';return;}
  progress.textContent='登録内容を確認中…';
  registerButton.disabled=true;registerButton.textContent='登録処理中…';
  try{await run(async()=>{
   try{await registerVideos()}catch(e){progress.textContent=e.message||'登録できませんでした。';}
  })}finally{registerButton.disabled=false;registerButton.textContent='試合動画・共有リンクをSSに登録';}
 }

 $('actions').append(button('全試合の短い共有リンクを発行',()=>run(publishHighlights)),
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
 })),button('新しい開催を開始',()=>{
  if(busy||!confirm('新しい開催に切り替えます。現在の下書きと共有リンクの更新権限はこの端末から消去されます。'))return;
  project=initialProject();state.sources=[];originals.clear();save();syncSources();refresh();workflow.setStage('analysis');
 }));
 syncSources();refresh();
 return {save,refresh};
}
