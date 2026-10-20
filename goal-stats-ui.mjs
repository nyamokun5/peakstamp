/**
 * Unified, goal-first video review. All source files appear in one ordered
 * queue. One persistent HTMLVideoElement serves every candidate. No video
 * gets reset merely because a card, field or summary rerenders.
 */
import {createGoalDrafts,saveGoalDrafts,makeManualGoal,validateGoal,
 confirmedGoalExport,goalSourceKey,actualGoalTime} from './goal-stats.mjs?v=40';
import {shareCalloutJson,copyCalloutJson} from './callout-export.mjs?v=37';
import {collectGoalQueue,nextPendingGoal} from './goal-review-queue.mjs?v=40';

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

export function initGoalStatsReview(state,{onUpdate=()=>{},onKeepClip=()=>false,onBeforePlay=()=>{}}={}){
 const panel=$('goalStatsPanel');
 if(!panel)return {refresh:()=>{},nearby:()=>[],openAt:()=>{},hasRecords:()=>false,pausePlayback:()=>{}};
 const list=$('goalStatsList'),editor=$('goalStatsEditor'),video=$('goalStatsPreview');
 const summary=$('goalStatsSummary'),status=$('goalStatsStatus');
 const label=$('goalStatsPlayingLabel'),viewer=$('goalStatsViewer');
 const add=$('goalStatsAdd'),manualSource=$('goalStatsManualSource');
 const exportButton=$('goalStatsExport'),copyButton=$('goalStatsCopy'),showButton=$('goalStatsShow');
 const textBox=$('goalStatsJsonArea'),textArea=$('goalStatsJson');
 const cache=()=>window.localStorage;
 const sources=()=>state.sources.filter(s=>s?.file&&s?.objectUrl);
 const goalData=s=>createGoalDrafts(s,cache());
 const queue=()=>collectGoalQueue(sources(),cache());
 let activeKey='',loadedSourceKey='',pendingSeek=null,lastVideoError='',videoRequest=0;
 const say=s=>{status.textContent=s;};
 function pausePlayback(){video.pause();}
 function disposeVideo(){
  videoRequest++;
  video.pause();video.removeAttribute('src');video.load();
  video.hidden=true;loadedSourceKey='';pendingSeek=null;
 }
 // Single metadata listener for the whole session; never installed per card.
 video.addEventListener('loadedmetadata',()=>{
  if(pendingSeek&&pendingSeek.sourceKey===loadedSourceKey){
   try{video.currentTime=pendingSeek.time;}catch(_){}
   pendingSeek=null;
  }
 });
 video.addEventListener('error',()=>{
  lastVideoError='元動画の読み込みに失敗しました。ファイルを再選択して再試行してください。';
  say(lastVideoError);
 });
 video.addEventListener('waiting',()=>{$('goalStatsVideoStatus').textContent='映像を読み込み中…';});
 video.addEventListener('playing',()=>{$('goalStatsVideoStatus').textContent='';});
 video.addEventListener('seeked',()=>{$('goalStatsVideoStatus').textContent='';});

 function seekTo(entry,{autoplay=false}={}){
  if(!entry)return;
  const {source,item}=entry,key=goalSourceKey(source);
  const seek=Math.max(0,actualGoalTime(item)-10);
  const switching=loadedSourceKey!==key;
  if(switching){
   videoRequest++;
   video.pause();
   pendingSeek={sourceKey:key,time:seek,request:videoRequest};
   // Avoid multiple iOS decoder loads: set src/load ONCE per distinct file.
   // Assigning src already triggers the browser media load algorithm.
   // Calling load() again can reset Safari's decoder mid-seek.
   video.preload='metadata';
   video.src=source.objectUrl;
   loadedSourceKey=key;
  }else if(video.readyState>=1){
   try{video.currentTime=seek;}catch(_){pendingSeek={sourceKey:key,time:seek,request:videoRequest};}
  }else{
   pendingSeek={sourceKey:key,time:seek,request:videoRequest};
  }
  video.hidden=false;viewer.hidden=false;
  label.textContent=source.file.name+' · ゴール '+fmt(actualGoalTime(item))+
   '（実況 '+(item.origin==='audio'?fmt(item.timeSeconds):'手動追加')+'）';
  if(autoplay){
   onBeforePlay();
   try{
    // Invoke play() synchronously from the originating click for iOS gesture permission.
    const attempt=video.play();
    if(attempt?.catch)attempt.catch(()=>{
     $('goalStatsVideoStatus').textContent='再生を開始できませんでした。動画の▶をタップしてください。';
    });
   }catch(_){$('goalStatsVideoStatus').textContent='動画の▶をタップして再生してください。';}
  }else video.pause();
 }
 function locate(key){
  return queue().find(row=>row.key===key)||null;
 }
 function focusActive(entry,{autoplay=false,scroll=true}={}){
  if(!entry)return;
  activeKey=entry.key;
  manualSource.value=goalSourceKey(entry.source);
  render();
  seekTo(entry,{autoplay});
  if(scroll)viewer.scrollIntoView({behavior:'auto',block:'start'});
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
  render();
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
    : '手動入力 · ゴール '+fmt(actualGoalTime(item)));
  head.append(detail);editor.append(head);
  editor.append(make('p','goal-review-quote',item.quote||''));
  const play=make('button','goal-review-play','▶ ゴールの10秒前から再生');
  play.type='button';
  play.addEventListener('click',()=>{seekTo(entry,{autoplay:true});viewer.scrollIntoView({behavior:'auto',block:'start'});});
  editor.append(play);
  const fields=make('div','goal-review-fields');
  const timing=make('div','goal-review-time-adjust');
  timing.append(make('strong','','プレー時刻を調整'));
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
  const useVideo=make('button','goal-review-mark-button','⏱ 動画の停止位置をゴール時刻にする');
  useVideo.type='button';
  useVideo.addEventListener('click',()=>{
   if(loadedSourceKey!==goalSourceKey(source)||video.readyState<1||
      !Number.isFinite(video.currentTime)){
    say('先にこのゴールの動画を再生してください。');return;
   }
   const at=Math.round(video.currentTime*10)/10;
   video.pause();
   changeTime(at);
   say('ゴール時刻を '+fmt(at)+' に調整しました。');
  });
  timing.append(earlier,stamp,later,useVideo);
  editor.append(timing);
  inputRow(fields,'得点者',item.scorer,v=>edit(entry,'scorer',v),{placeholder:'例：若さん'});
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
  const optional=make('details','goal-optional-fields');
  optional.append(make('summary','','詳細：対戦カード・試合番号・メモ'));
  const optionalBody=make('div','goal-review-fields');
  inputRow(optionalBody,'対戦チーム',item.matchLabel,v=>edit(entry,'matchLabel',v));
  inputRow(optionalBody,'SS試合番号（任意）',item.matchSeq||'',v=>edit(entry,'matchSeq',v),{type:'number',placeholder:'例：3'});
  inputRow(optionalBody,'メモ（任意）',item.note||'',v=>edit(entry,'note',v),{maxLength:400});
  optional.append(optionalBody);
  editor.append(fields,optional);
  const actions=make('div','goal-review-actions');
  const confirm=make('button','goal-review-confirm',item.status==='confirmed'?'✓ 確定済み':'✓ 確定して次へ');
  confirm.type='button';confirm.disabled=item.status==='confirmed'||disabled;
  confirm.addEventListener('click',()=>{
   const error=validateGoal(item);
   if(error){say('確定できません：'+error);return;}
   item.status='confirmed';item.goalTimeVerified=true;
   item.confirmedAt=new Date().toISOString();
   write(source,goalData(source).items.map(x=>x.id===item.id?item:x));
   const next=nextPendingGoal(queue(),entry.key);
   if(next){
    focusActive(next,{autoplay:true});
    say('ゴールを確定しました。次の未確定候補に進みました。');
   }else{
    video.pause();activeKey='__all_done__';render();
    summary.scrollIntoView({behavior:'auto',block:'start'});
    say('ゴールを確定しました。未確定候補はありません。');
   }
   onUpdate();
  });
  const reject=make('button','goal-review-exclude',
   item.status==='excluded'?'除外を取り消す':'✕ ゴールではない');
  reject.type='button';
  reject.addEventListener('click',()=>{
   const now=item.status==='excluded'?'draft':'excluded';
   item.status=now;item.confirmedAt=null;
   write(source,goalData(source).items.map(x=>x.id===item.id?item:x));
   const next=now==='excluded'?nextPendingGoal(queue(),entry.key):null;
   if(next)focusActive(next,{autoplay:false});
   else render();
   onUpdate();
  });
  const keep=make('button','goal-review-keep-clip','＋ 動画にもキープ');
  keep.type='button';keep.disabled=!source.bins;
  keep.title=source.bins?'動画編集用にもクリップをキープ':'通常の見どころ解析後に利用できます';
  keep.addEventListener('click',()=>{
   if(onKeepClip(source,item))say('ゴールを動画のキープ済みに追加しました。得点確定とは別です。');
  });
  actions.append(confirm,reject,keep);editor.append(actions);
 }
 function render(){
  const all=sources(),entries=queue();
  panel.hidden=all.length===0;
  if(!all.length){
   disposeVideo();list.replaceChildren();editor.replaceChildren();return;
  }
  if(loadedSourceKey&&!all.some(s=>goalSourceKey(s)===loadedSourceKey))disposeVideo();
  const pending=entries.filter(row=>row.item.status==='draft').length;
  const confirmed=entries.filter(row=>row.item.status==='confirmed').length;
  const excluded=entries.filter(row=>row.item.status==='excluded').length;
  summary.textContent='ゴール候補 '+entries.length+'件  ·  未確定 '+pending+
   '件  ·  確定 '+confirmed+'件'+(excluded?'  ·  除外 '+excluded+'件':'');
  exportButton.disabled=copyButton.disabled=showButton.disabled=confirmed===0;
  const previous=entries.find(row=>row.key===activeKey);
  // Keep the completion state until a genuinely new unconfirmed goal appears.
  if(activeKey==='__all_done__'&&pending>0)
   activeKey=entries.find(row=>row.item.status==='draft').key;
  if(!previous && !activeKey)activeKey=(entries.find(row=>row.item.status==='draft')||entries[0])?.key||'';
  const active=entries.find(row=>row.key===activeKey);
  if(!active){viewer.hidden=true;video.pause();}
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
      (item.matchLabel?'　·　'+item.matchLabel:''));
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
    'まだゴール候補がありません。音声の実況解析を実行するか、手動で追加してください。'));
   viewer.hidden=true;video.pause();
  }
  // A single video stays mounted above the editor, even when many cards change.
  // Never reload the same MOV just because the summary or fields were edited.
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
  render();
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
