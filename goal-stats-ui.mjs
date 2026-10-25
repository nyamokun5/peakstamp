/**
 * Unified, goal-first video review. All source files appear in one ordered
 * queue. One persistent HTMLVideoElement serves every candidate. No video
 * gets reset merely because a card, field or summary rerenders.
 */
import {createGoalDrafts,saveGoalDrafts,makeManualGoal,validateGoal,
 confirmedGoalExport,goalSourceKey,actualGoalTime} from './goal-stats.mjs?v=unifiedga1';
import {shareCalloutJson,copyCalloutJson} from './callout-export.mjs?v=37';
import {collectGoalQueue,nextUnreviewedGoalVideo,goalNeedsVideoReview} from './goal-review-queue.mjs?v=unifiedga1';
import {createGoalPlaybackController} from './goal-playback.mjs?v=goalnative1';
import {createGoalSceneControls} from './goal-scene-editor.mjs?v=unifiedga1';

const $=id=>document.getElementById(id);
const make=(tag,cls,text)=>{
 const el=document.createElement(tag);
 if(cls)el.className=cls;
 if(text!==undefined)el.textContent=text;
 return el;
};
const fmt=s=>{
 const ticks=Math.max(0,Math.round((Number(s)||0)*10)),secs=Math.floor(ticks/10);
 return String(Math.floor(secs/60)).padStart(2,'0')+':'+
  String(secs%60).padStart(2,'0')+'.'+(ticks%10);
};
const exportName=()=> 'PeakStamp_Confirmed_Goals_'+new Date().toISOString().slice(0,10)+'.json';
function inputRow(parent,label,value,commit,{type='text',placeholder='',maxLength=120}={}){
 const box=make('label','goal-review-field');
 const name=make('span','',label);
 const input=make('input','');
 input.type=type;input.value=value===undefined||value===null?'':String(value);
 input.placeholder=placeholder;input.maxLength=maxLength;
 input.addEventListener('change',()=>commit(input.value));
 box.append(name,input);parent.append(box);
 return input;
}

export function initGoalStatsReview(state,{onUpdate=()=>{},onSourceReady=()=>{},onKeepClip=()=>false,onRejectClip=()=>false,onClipEdit=()=>{},onBeforePlay=()=>{}}={}){
 const panel=$('goalStatsPanel');
 if(!panel)return {refresh:()=>{},nearby:()=>[],openAt:()=>{},hasRecords:()=>false,pausePlayback:()=>{}};
 const list=$('goalStatsList'),editor=$('goalStatsEditor'),video=$('goalStatsPreview');
 const summary=$('goalStatsSummary'),status=$('goalStatsStatus');
 const label=$('goalStatsPlayingLabel'),viewer=$('goalStatsViewer');
 const done=$('goalStatsDone'),doneText=$('goalStatsDoneText');
 const doneRegular=$('goalStatsDoneToRegular'),doneAdd=$('goalStatsDoneAdd');
 const add=$('goalStatsAdd'),manualSource=$('goalStatsManualSource');
 const exportButton=$('goalStatsExport'),copyButton=$('goalStatsCopy'),showButton=$('goalStatsShow');
 const textBox=$('goalStatsJsonArea'),textArea=$('goalStatsJson');
 const cache=()=>window.localStorage;
 const sources=()=>state.sources.filter(s=>s?.file&&s?.objectUrl);
 const goalData=s=>createGoalDrafts(s,cache());
 const queue=()=>collectGoalQueue(sources(),cache());
 let activeKey='',displayedKey='',hadGoalCandidates=false;
 const say=s=>{status.textContent=s;};
 const player=createGoalPlaybackController(video,{
  notify:s=>{$('goalStatsVideoStatus').textContent=s;},
  beforePlay:onBeforePlay
 });
 const scene=createGoalSceneControls({
  viewer,video,label,status:$('goalStatsVideoStatus'),
  onChange:(src,record)=>{
   const rows=goalData(src).items.map(x=>x.id===record.id?record:x);
   write(src,rows);
   if(record.videoDecision==='kept')onClipEdit(src,record);
  },
  onReplay:()=>seekTo(locate(activeKey),{autoplay:true}),
  onSeek:time=>seekTo(locate(activeKey),{autoplay:true,at:time}),
  onPause:()=>player.pause(),
  onNative:()=>{
   const entry=locate(activeKey);
   if(!entry)return;
   const {source,item}=entry;
   scene.activate(source,item);
   const bounds=scene.clipBounds();
   viewer.classList.add('goal-native-player');
   viewer.hidden=false;
   scene.showVideo(true);
   player.open({sourceKey:goalSourceKey(source),sourceUrl:source.objectUrl,
    at:bounds.start,native:true});
   scene.redraw();
  }
 });
 video.addEventListener('loadedmetadata',()=>{
  // Goal transcripts may exist before the normal waveform analyzer runs.
  // Obtain duration from the shared video so the clip can be kept directly.
  const active=locate(activeKey);
  if(active&&player.currentSourceKey()===goalSourceKey(active.source)&&
    !(Number(active.source.duration)>0)&&Number.isFinite(video.duration)&&video.duration>0){
   active.source.duration=video.duration;
   // A returning user may have saved video decisions but no waveform.
   // Reconcile them as soon as the original MOV reports its duration.
   onSourceReady(active.source);
   scene.activate(active.source,active.item);
   render();
   scene.redraw();
  }
 });
 function pausePlayback(){player.pause();}
 function disposeVideo(){player.dispose();viewer.hidden=true;displayedKey='';}
 function seekTo(entry,{autoplay=false,at=null}={}){
  if(!entry)return;
  displayedKey=entry.key;
  const {source,item}=entry;
  // Keep the editor controls visible. The MOV itself is opened lazily only
  // when Replay is tapped, exactly like normal highlight cards.
  viewer.hidden=false;
  viewer.classList.remove('goal-native-player');
  scene.showVideo(autoplay);
  label.textContent=source.file.name+' · ゴール '+fmt(actualGoalTime(item))+
   '（'+(item.origin==='audio'?'実況 '+fmt(item.timeSeconds):item.origin==='gemini'?'Geminiの音声反応 '+fmt(item.timeSeconds):'手動追加')+'）';
  scene.activate(source,item);
  const bounds=scene.clipBounds();
  player.open({
   sourceKey:goalSourceKey(source),sourceUrl:source.objectUrl,
   at:Number.isFinite(at)?Math.max(bounds.start,Math.min(bounds.end-.2,at)):bounds.start,
   autoplay
  });
  scene.redraw();
 }
 function locate(key){
  return queue().find(row=>row.key===key)||null;
 }
 function focusActive(entry,{autoplay=false,scroll=true}={}){
  if(!entry)return;
  activeKey=entry.key;
  manualSource.value=goalSourceKey(entry.source);
  // The first preview is opened by this actual user tap. Do not let the
  // passive render seek first, which can interrupt iPhone Safari playback.
  displayedKey=entry.key;
  render();
  seekTo(entry,{autoplay});
  if(scroll)panel.scrollIntoView({behavior:'smooth',block:'start'});
 }
 function write(source,items){
  if(!saveGoalDrafts(source,cache(),items))
   say('端末に自動保存できませんでした。空き容量などを確認し、JSONも保存してください。');
 }
 function edit(entry,name,value){
  const {source,item}=entry;
  if(String(item[name]??'')===String(value??''))return;
  item[name]=value;
  if(name==='goalTimeSeconds'){
   item.goalTimeEdited=true;item.goalTimeVerified=false;
  }
  if(item.status==='confirmed'){item.status='draft';item.confirmedAt=null;}
  const items=goalData(source).items.map(x=>x.id===item.id?item:x);
  write(source,items);
  if(item.videoDecision==='kept')onClipEdit(source,item);
  render();
 }
 function setVideoDecision(entry,decision){
  const {source,item}=entry,previous=item.videoDecision||null;
  if(decision!=='kept'&&decision!=='rejected')return;
  if(decision==='kept' && !(Number(source.duration)>0)){
   say('動画の読み込みが終わってからキープしてください。');return;
  }
  // Persist before reconciling, so re-renders (including reanalysis) honor it.
  item.videoDecision=decision;
  write(source,goalData(source).items.map(x=>x.id===item.id?item:x));
  const ok=decision==='kept'?onKeepClip(source,item):onRejectClip(source,item);
  if(!ok){
   item.videoDecision=previous;
   write(source,goalData(source).items.map(x=>x.id===item.id?item:x));
   say('動画の判定を保存できませんでした。動画を再読み込みしてください。');
   render();return;
  }
  // Once this video has been judged, continue to the next untouched goal.
  // Score confirmation remains separate and can be revisited via the queue.
  const next=nextUnreviewedGoalVideo(queue(),entry.key);
  if(next){
   // Switching is performed within the original Keep/Reject tap so iOS
   // can authorize playback of the next MOV. The main app no longer
   // synchronously refreshes this editor during the decision callback.
   focusActive(next,{autoplay:true,scroll:true});
   say((decision==='kept'?'動画をキープ':'動画を不採用')+
    'にしました。次の未判断ゴールへ進みました。');
  }else{
   // Distinguish a completed one-goal queue from a broken auto-advance:
   // no new candidate exists until the user adds or detects another goal.
   render();panel.scrollIntoView({behavior:'smooth',block:'start'});
   say('ゴール動画は全件判定済みです。残り0件。次のゴール候補はありません。');
  }
 }
 function renderEditor(entry){
  editor.replaceChildren();
  if(!entry){
   editor.append(make('p','goal-review-done','すべてのゴール候補を確認しました。必要なら下の一覧から再編集できます。'));
   return;
  }
  const {source,item}=entry,disabled=item.status==='excluded';
  const head=make('div','goal-editor-title');
  head.append(make('strong','',source.file.name+' · ゴール '+fmt(actualGoalTime(item))));
  const detail=make('small','',
   item.origin==='audio'
    ? '実況 '+fmt(item.timeSeconds)+' ／ ゴール推定 '+fmt(actualGoalTime(item))+
      (item.goalTimeVerified?'（映像確認済み）':'（10秒前の仮時刻）')
    : item.origin==='gemini'
    ? 'Gemini音声からのゴール候補 '+fmt(item.timeSeconds)+
      '（確信度：'+(item.geminiConfidence||'不明')+'）／映像で確認が必要'
    : '手動入力 · ゴール '+fmt(actualGoalTime(item)));
  head.append(detail);editor.append(head);
  if(item.quote){
   const quote=make('details','goal-review-quote-details');
   quote.append(make('summary','',item.origin==='gemini'?'検出した音声・判断根拠を見る':'検出された実況を確認'));
   quote.append(make('p','goal-review-quote',item.quote));
   if(item.origin==='gemini'&&item.audioClue)
    quote.append(make('p','goal-review-quote',item.audioClue));
   editor.append(quote);
  }
  const fields=make('div','goal-review-fields');
  const timing=make('details','goal-review-time-adjust');
  timing.append(make('summary','','⏱ ゴール時刻を修正（切り抜きとは別）'));
  const timingTools=make('div','goal-review-time-tools');
  const earlier=make('button','goal-review-adjust-button','−1秒');
  const later=make('button','goal-review-adjust-button','＋1秒');
  const stamp=make('input','goal-review-time-input');
  stamp.type='number';stamp.min='0';stamp.step='0.1';stamp.value=String(actualGoalTime(item));
  stamp.setAttribute('aria-label','ゴールの動画内時刻（秒）');
  const changeTime=val=>{
   const time=Number(val);
   if(String(val).trim()===''||!Number.isFinite(time)||time<0||
      (Number(source.duration)>0&&time>source.duration)){
    say('動画内の正しい秒数を入力してください。');return;
   }
   edit(entry,'goalTimeSeconds',Math.round(time*10)/10);
  };
  earlier.type=later.type='button';
  earlier.addEventListener('click',()=>changeTime(Math.max(0,actualGoalTime(item)-1)));
  later.addEventListener('click',()=>changeTime(actualGoalTime(item)+1));
  stamp.addEventListener('change',()=>changeTime(stamp.value));
  const useVideo=make('button','goal-review-mark-button','⏱ 現在の再生位置をゴール時刻に設定');
  useVideo.type='button';
  useVideo.addEventListener('click',()=>{
   if(player.currentSourceKey()!==goalSourceKey(source)||video.readyState<1||
      !Number.isFinite(video.currentTime)){
    say('先にこのゴールの動画を再生してください。');return;
   }
   const at=Math.round(video.currentTime*10)/10;
   player.pause();
   changeTime(at);
   say('ゴール時刻を '+fmt(at)+' に調整しました。');
  });
  timingTools.append(earlier,stamp,later,useVideo);
  timing.append(timingTools);
  inputRow(fields,'得点者（ゴール）',item.scorer,v=>edit(entry,'scorer',v),{placeholder:'例：若さん'});
  const assistBox=make('label','goal-review-field');
  assistBox.append(make('span','','アシスト'));
  const assistChoice=make('select','');
  for(const [value,text] of [
   ['named','アシストあり'],['none','アシストなし'],['unknown','不明・未確認']
  ]){
   const option=make('option','',text);option.value=value;assistChoice.append(option);
  }
  assistChoice.value=item.assistStatus||'unknown';
  assistChoice.addEventListener('change',()=>edit(entry,'assistStatus',assistChoice.value));
  assistBox.append(assistChoice);fields.append(assistBox);
  if(item.assistStatus==='named')
   inputRow(fields,'アシスト者',item.assist,v=>edit(entry,'assist',v),{placeholder:'例：野田さん'});
  inputRow(fields,'対戦カード',item.matchLabel,v=>edit(entry,'matchLabel',v),{placeholder:'例：3 vs 4'});
  inputRow(fields,'SS試合番号（任意）',item.matchSeq||'',v=>edit(entry,'matchSeq',v),{type:'number',placeholder:'例：3'});
  const optional=make('details','goal-optional-fields');
  optional.append(make('summary','','詳細：チーム番号・メモ'));
  const optionalBody=make('div','goal-review-fields');
  inputRow(optionalBody,'チームA',item.teamA||'',v=>edit(entry,'teamA',v),{placeholder:'例：3'});
  inputRow(optionalBody,'チームB',item.teamB||'',v=>edit(entry,'teamB',v),{placeholder:'例：4'});
  inputRow(optionalBody,'メモ（任意）',item.note||'',v=>edit(entry,'note',v),{maxLength:400});
  optional.append(optionalBody);
  editor.append(fields,timing,optional);
  const actions=make('div','goal-review-actions');
  const confirm=make('button','goal-review-confirm',item.status==='confirmed'?'✓ 得点情報は確定済み':'✓ 得点情報を確定');
  confirm.type='button';confirm.disabled=item.status==='confirmed'||disabled;
  confirm.addEventListener('click',()=>{
   const error=validateGoal(item);
   if(error){say('確定できません：'+error);return;}
   item.status='confirmed';item.goalTimeVerified=true;
   item.confirmedAt=new Date().toISOString();
   write(source,goalData(source).items.map(x=>x.id===item.id?item:x));
   // Confirming scorer/assist must not silently skip the video decision.
   // Keep the player and the Keep/Reject buttons visible until judged.
   render();
   say(item.videoDecision
    ?'得点情報を確定しました。動画の判定は保存済みです。'
    :'得点情報を確定しました。動画をキープ／不採用にすると次のゴールへ進みます。');
   onUpdate();
  });
  const reject=make('button','goal-review-exclude',
   item.status==='excluded'?'除外を取り消す':'✕ ゴールではない');
  reject.type='button';
  reject.addEventListener('click',()=>{
   const now=item.status==='excluded'?'draft':'excluded';
   item.status=now;item.confirmedAt=null;
   write(source,goalData(source).items.map(x=>x.id===item.id?item:x));
   if(now==='excluded'&&!item.videoDecision){
    // Not a goal: dismiss its unjudged goal video too. This is reversible
    // from the candidate list; independently kept highlight clips are safe.
    setVideoDecision(entry,'rejected');
   }else{
    const next=now==='excluded'?nextUnreviewedGoalVideo(queue(),entry.key):null;
    if(next)focusActive(next,{autoplay:true});
    else render();
   }
   onUpdate();
  });
  actions.append(confirm,reject);
  // Video selection happens HERE. No second Keep/Reject in the normal list.
  // Score confirmation and clip inclusion are intentionally independent.
  const videoActions=make('div','goal-review-video-actions');
  const videoStatus=make('p','goal-review-video-status');
  const linked=source.candidates?.find(c=>c.goalRecordId===item.id&&c.enabled===true);
  const decision=item.videoDecision||(linked?'kept':null);
  const videoKeep=make('button','goal-review-video-keep','✓ 動画をキープ');
  const videoReject=make('button','goal-review-video-reject','✕ 動画は不採用');
  videoKeep.type=videoReject.type='button';
  videoKeep.disabled=!(Number(source.duration)>0);
  videoKeep.setAttribute('aria-pressed',String(decision==='kept'));
  videoReject.setAttribute('aria-pressed',String(decision==='rejected'));
  videoKeep.className='goal-review-video-keep'+(decision==='kept'?' is-active':'');
  videoReject.className='goal-review-video-reject'+(decision==='rejected'?' is-active':'');
  videoStatus.textContent=decision==='kept'
   ?'動画：キープ済み（完成ハイライトに自動追加）'
   :decision==='rejected'
    ?'動画：不採用（完成ハイライトには含めません）'
    :'動画：未判断（ここでキープ／不採用を選択）';
  videoKeep.addEventListener('click',()=>setVideoDecision(entry,'kept'));
  videoReject.addEventListener('click',()=>setVideoDecision(entry,'rejected'));
  videoActions.append(videoKeep,videoReject);
  editor.append(videoStatus,videoActions,actions);
 }
 function render(){
  const all=sources(),entries=queue();
  // This standalone priority panel appears as soon as there are actual
  // goals, transcript results, or a completed waveform analysis.
  panel.hidden=all.length===0 || (!entries.length &&
    !all.some(source=>Boolean(goalData(source).transcript)||Boolean(source.bins)));
  if(!all.length){
   disposeVideo();list.replaceChildren();editor.replaceChildren();return;
  }
  if(player.currentSourceKey()&&!all.some(s=>goalSourceKey(s)===player.currentSourceKey()))disposeVideo();
  const pending=entries.filter(row=>row.item.status==='draft').length;
  const confirmed=entries.filter(row=>row.item.status==='confirmed').length;
  const excluded=entries.filter(row=>row.item.status==='excluded').length;
  const videoKept=entries.filter(x=>x.item.videoDecision==='kept').length;
  const videoRejected=entries.filter(x=>x.item.videoDecision==='rejected').length;
  summary.textContent='ゴール候補 '+entries.length+'件  ·  得点未確定 '+pending+
   '件  ·  得点確定 '+confirmed+'件'+(excluded?'  ·  除外 '+excluded+'件':'')+
   '  ·  動画キープ '+videoKept+'件  ·  動画不採用 '+videoRejected+'件';
  exportButton.disabled=copyButton.disabled=showButton.disabled=confirmed===0;
  const previous=entries.find(row=>row.key===activeKey);
  if(!previous){
   const firstToReview=entries.find(row=>goalNeedsVideoReview(row.item));
   activeKey=(firstToReview||entries[0])?.key||'';
  }
  const active=entries.find(row=>row.key===activeKey);
  if(!active){viewer.hidden=true;displayedKey='';player.pause();}
  if(active)scene.activate(active.source,active.item);
  const index=active?entries.findIndex(row=>row.key===active.key):-1;
  const waiting=entries.filter(row=>goalNeedsVideoReview(row.item)).length;
  const complete=entries.length>0&&waiting===0;
  $('goalStatsStep').textContent=active
   ?'⚽ ゴール '+(index+1)+' / '+entries.length+
     (waiting?'　·　動画未判断 '+waiting+'件':'　·　全'+entries.length+'件の動画判定完了')+
     (waiting?'　·　リプレイで確認 → キープ／不採用':'　·　残り0件')
   :entries.length?'すべての候補を確認しました':'まだゴール候補はありません';
  done.hidden=!complete;
  if(complete){
   doneText.textContent='✓ ゴール動画 '+entries.length+'件の判定が完了しました（残り0件）';
   // Other regular highlights may still be available. Keep the goal
   // player's Replay/edit controls available for last-minute changes.
   doneRegular.hidden=$('resultsPanel').hidden||$('standardReviewArea').hidden;
  }
  renderEditor(active);
  const cards=[];
  for(const [index,entry] of entries.entries()){
   const {item,source,key}=entry;
   const row=make('button','goal-queue-row'+(key===activeKey?' is-active':''),undefined);
   row.type='button';row.dataset.goalKey=key;
   row.setAttribute('aria-current',key===activeKey?'true':'false');
   const main=make('span','goal-queue-primary',
    (index+1)+'.  '+source.file.name+'   ·   '+fmt(actualGoalTime(item)));
   const names=make('span','goal-queue-secondary',
    (item.scorer||'得点者未入力')+' ／ '+(item.assistStatus==='named'
      ?(item.assist||'アシスト未入力')+' アシスト'
      :item.assistStatus==='none'?'アシストなし':'アシスト未確認')+
      (item.matchLabel?'　·　'+item.matchLabel:'')+
      (item.videoDecision==='kept'?'　·　🎬 動画キープ':item.videoDecision==='rejected'?'　·　動画不採用':''));
   const badge=make('span','goal-queue-badge '+item.status,
    item.status==='confirmed'?'確定済み':item.status==='excluded'?'除外':'未確定');
   row.append(main,names,badge);
   row.addEventListener('click',()=>focusActive(entry,{autoplay:true}));
   cards.push(row);
  }
  list.replaceChildren(...cards);
  if(!entries.length){
   editor.replaceChildren();
   editor.append(make('p','goal-review-meta',
    'ゴール候補がありません。統合Gemini解析を実行するか、手動で追加してください。'));
   viewer.hidden=true;displayedKey='';player.pause();
  }else if(!panel.hidden && active && displayedKey!==active.key){
   // Show metadata and Replay button immediately, but do NOT begin a
   // heavyweight MOV seek before the first explicit user tap.
   seekTo(active,{autoplay:false});
  }
  // One player/decoder is mounted for all candidates. Rerendering fields
  // does not force a MOV reload or restart a scene already being edited.
 }
 function hasRecords(){return sources().some(s=>Boolean(goalData(s).transcript)||goalData(s).items.length>0);}
 function nearby(source,time,start,end){
  return goalData(source).items.filter(x=>x.status!=='excluded'&&
   (Math.abs(actualGoalTime(x)-Number(time))<=12||
    (actualGoalTime(x)>=Number(start)-2&&actualGoalTime(x)<=Number(end)+2)));
 }
 function openAt(source,time){
  const entries=queue().filter(row=>goalSourceKey(row.source)===goalSourceKey(source));
  const entry=entries.sort((a,b)=>Math.abs(actualGoalTime(a.item)-time)-
   Math.abs(actualGoalTime(b.item)-time))[0];
  if(entry)focusActive(entry,{autoplay:true});
  else{render();panel.scrollIntoView({behavior:'auto',block:'start'});}
 }
 doneRegular.addEventListener('click',()=>{
  const target=$('standardReviewArea');
  if(!target.hidden && !$('resultsPanel').hidden)
   target.scrollIntoView({behavior:'smooth',block:'start'});
 });
 doneAdd.addEventListener('click',()=>add.click());
 add.addEventListener('click',()=>{
  const all=sources();if(!all.length)return;
  const src=all.find(s=>goalSourceKey(s)===manualSource.value)||
   locate(activeKey)?.source||all[0];
  const raw=window.prompt('動画内のゴール時刻（例：06:14.2 または 374.2秒）');
  if(raw===null)return;
  const input=String(raw).trim(),parts=input.split(':');
  let seconds=Number(input);
  if(parts.length===2)seconds=Number(parts[0])*60+Number(parts[1]);
  if(!input||!Number.isFinite(seconds)||seconds<0||
     (Number(src.duration)>0&&seconds>src.duration)){
   say('ゴール時刻が不正です。例：06:14.2、374.2');return;
  }
  const data=goalData(src),record=makeManualGoal(Math.round(seconds*10)/10,src,cache());
  data.items.push(record);write(src,data.items);
  activeKey=goalSourceKey(src)+'::'+record.id;
  render();seekTo({source:src,item:record},{autoplay:false});
  viewer.scrollIntoView({behavior:'auto',block:'start'});
  say('手動ゴールを追加しました。プレーと選手名を確認してください。');
 });
 function refresh(){
  const all=sources();
  const old=manualSource.value;
  manualSource.replaceChildren();
  for(const src of all){
   const option=make('option','',src.file.name);
   option.value=goalSourceKey(src);manualSource.append(option);
  }
  manualSource.value=all.some(s=>goalSourceKey(s)===old)?old:goalSourceKey(all[0]);
  $('goalStatsManualWrap').hidden=all.length<=1;
  const nowHasGoals=queue().length>0;
  const justDetected=nowHasGoals&&!hadGoalCandidates;
  hadGoalCandidates=nowHasGoals;
  render();
  if(justDetected&&!panel.hidden){
   // The callout analysis tool lives BELOW goal review. Show the first
   // goal's Replay button; loading the MOV is deferred until it is tapped.
   const go=()=>panel.scrollIntoView({behavior:'smooth',block:'start'});
   if(typeof requestAnimationFrame==='function')requestAnimationFrame(go);
   else go();
  }
 }
 function snapshot(){
  const data=confirmedGoalExport(sources(),cache());
  return {text:JSON.stringify(data,null,2),count:data.goals.length,filename:exportName()};
 }
 const reveal=text=>{textBox.hidden=false;textArea.value=text;showButton.textContent='JSONを閉じる';};
 exportButton.addEventListener('click',async()=>{
  const data=snapshot();if(!data.count)return;
  try{
   const response=await shareCalloutJson(data.text,data.filename);
   if(response==='completed')say('共有画面が開きました。iPhoneの「ファイルに保存」で保存できます。SSアプリには未送信です。');
   else if(response==='cancelled')say('共有をキャンセルしました。PSの確定情報は残っています。');
   else{reveal(data.text);say('共有非対応のためJSONを表示しました。コピーできます。');}
  }catch(e){reveal(data.text);say('共有エラー：'+(e?.message||String(e))+'。JSONを表示しました。');}
 });
 copyButton.addEventListener('click',async()=>{
  const data=snapshot();if(!data.count)return;reveal(data.text);
  const ok=await copyCalloutJson(data.text,{textarea:textArea});
  say(ok?'確定済みゴールのJSONをコピーしました。SSアプリには未送信です。':
   'コピーできない場合は表示されたJSONを長押ししてコピーしてください。');
 });
 showButton.addEventListener('click',()=>{
  if(!textBox.hidden){textBox.hidden=true;showButton.textContent='JSONを表示';}
  else reveal(snapshot().text);
 });
 refresh();
 return {refresh,nearby,openAt,hasRecords,pausePlayback};
}
