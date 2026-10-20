/**
 * Browser UI for manually verifying recorded goals before any SS sync.
 * Goal confirmation is independent of Keep/Reject and any MP4 export.
 */
import {createGoalDrafts,saveGoalDrafts,makeManualGoal,validateGoal,confirmedGoalExport,goalSourceKey,actualGoalTime} from './goal-stats.mjs?v=39';
import {formatCalloutTime} from './gemini-callouts.mjs?v=1';
import {shareCalloutJson,copyCalloutJson} from './callout-export.mjs?v=37';

const $=id=>document.getElementById(id);
const make=(tag,cls,content)=>{
 const x=document.createElement(tag);if(cls)x.className=cls;
 if(content!==undefined)x.textContent=content;return x;
};
function field(parent,name,value,onChange,{type='text',placeholder='',maxLength=120}={}){
 const holder=make('label','goal-review-field');
 holder.append(make('span','',name));
 const input=make('input','');
 input.type=type;input.value=value===undefined||value===null?'':String(value);
 input.placeholder=placeholder;input.maxLength=maxLength;
 input.addEventListener('change',()=>onChange(input.value));
 holder.append(input);parent.append(holder);
 return input;
}
const safeJsonFilename=()=> 'PeakStamp_Confirmed_Goals_'+new Date().toISOString().slice(0,10)+'.json';
const preciseTime=value=>{
 const ticks=Math.round(Math.max(0,Number(value)||0)*10);
 const seconds=Math.floor(ticks/10);
 return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')+'.'+(ticks%10);
};

export function initGoalStatsReview(state,{onUpdate=()=>{},onKeepClip=()=>false}={}){
 const panel=$('goalStatsPanel');
 if(!panel)return {refresh:()=>{},nearby:()=>[],openAt:()=>{}};
 const list=$('goalStatsList');
 const summary=$('goalStatsSummary');
 const status=$('goalStatsStatus');
 const video=$('goalStatsPreview');
 const exportButton=$('goalStatsExport');
 const copyButton=$('goalStatsCopy');
 const showButton=$('goalStatsShow');
 const textArea=$('goalStatsJson');
 const textBox=$('goalStatsJsonArea');
 const addButton=$('goalStatsAdd');
 let currentVideoSourceKey=null;
 let currentSelectedKey='';
 const store=()=>window.localStorage;
 const sources=()=>state.sources.filter(x=>x?.file&&x?.objectUrl);
 const selectedSource=()=>sources().find(s=>goalSourceKey(s)===currentSelectedKey)||sources()[0];
 const sourcePicker=$('goalStatsSource');
 function setStatus(message){status.textContent=message;}
 function clearVideo(){
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.hidden=true;
  currentVideoSourceKey=null;
 }
 async function playAt(source,time){
  try{
   const key=goalSourceKey(source);
   if(currentVideoSourceKey!==key){
    clearVideo();
    video.src=source.objectUrl;
    video.preload='metadata';
    currentVideoSourceKey=key;
   }
   video.hidden=false;
   if(video.readyState<1){
    await new Promise((resolve,reject)=>{
     const ready=()=>{cleanup();resolve();};
     const fail=()=>{cleanup();reject(Error('映像を読み込めませんでした。'))};
     const cleanup=()=>{video.removeEventListener('loadedmetadata',ready);video.removeEventListener('error',fail)};
     video.addEventListener('loadedmetadata',ready);video.addEventListener('error',fail);
     video.load();
    });
   }
   video.currentTime=Math.max(0,Number(time)-6);
   await video.play();
  }catch(e){setStatus('再生に失敗：'+(e?.message||String(e))+'。動画の再生ボタンをお試しください。');}
 }
 function allFor(source){return createGoalDrafts(source,store());}
 function write(source,items){
  if(!saveGoalDrafts(source,store(),items))setStatus('端末の保存容量などにより自動保存できませんでした。JSONのコピーもご利用ください。');
  onUpdate();
 }
 function render(){
  const all=sources();
  panel.hidden=!all.length;
  if(!all.length){
   list.replaceChildren();exportButton.disabled=true;copyButton.disabled=true;showButton.disabled=true;return;
  }
  const remembered=currentSelectedKey;
  sourcePicker.replaceChildren();
  for(const source of all){
   const opt=make('option','',source.file.name);opt.value=goalSourceKey(source);sourcePicker.append(opt);
  }
  currentSelectedKey=all.some(s=>goalSourceKey(s)===remembered)?remembered:goalSourceKey(all[0]);
  sourcePicker.value=currentSelectedKey;
  const source=selectedSource(),{items,transcript}=allFor(source);
  // The saved file is only written after manual edit/confirmation to keep analysis cheap.
  const goalCount=items.filter(x=>x.status!=='excluded').length;
  const confirmed=items.filter(x=>x.status==='confirmed').length;
  const allConfirmed=all.reduce((n,s)=>n+allFor(s).items.filter(x=>x.status==='confirmed'&&!validateGoal(x)).length,0);
  summary.textContent='この動画：'+goalCount+'件（確定 '+confirmed+'件）／ 選択中の全動画：確定 '+allConfirmed+'件';
  exportButton.disabled=copyButton.disabled=showButton.disabled=allConfirmed===0;
  const rows=[];
  if(transcript){
   const markerText=(transcript.data.utterances||[]).filter(x=>x.kind==='match_start')
     .map(x=>formatCalloutTime(x.time_seconds)+' '+(x.match_label||x.quote)).join(' ／ ');
   const meta=make('p','goal-review-meta','実況解析：'+transcript.scope+
    (transcript.legacy?'（旧結果）':'')+' ／ 対戦宣言：'+(markerText||'検出なし'));
   rows.push(meta);
  }else rows.push(make('p','goal-review-meta','実況結果がありません。上の「実況を文字で拾う」を実行するか、手動追加してください。'));
  if(!items.length)rows.push(make('p','goal-review-meta','得点候補なし。ゴールがあれば下の「ゴールを手動追加」から記録できます。'));
  for(const item of items){
   const card=make('article','goal-review-card');
   card.dataset.goalId=item.id;
   const headline=make('div','goal-review-head');
   headline.append(make('strong','',
     '⚽ ゴール候補 '+preciseTime(actualGoalTime(item))+' · '+
     (item.origin==='audio'?'実況解析':'手動追加')));
   const stateText=item.status==='confirmed'?'✓ 確定済み':item.status==='excluded'?'除外':'未確定';
   headline.append(make('span','goal-review-status '+item.status,stateText));
   card.append(headline);
   card.append(make('p','goal-review-quote',item.quote||''));
   if(item.origin==='audio'){
    const lag=Math.round((Number(item.timeSeconds)-actualGoalTime(item))*10)/10;
    card.append(make('p','goal-review-timing',
      '実況 '+preciseTime(item.timeSeconds)+' → 推定・確認ゴール '+preciseTime(actualGoalTime(item))+
      '（実況の約'+lag+'秒前）'+(item.goalTimeVerified?' · 時刻確認済み':' · 仮設定')));
   }else card.append(make('p','goal-review-timing',
     'ゴール時刻 '+preciseTime(actualGoalTime(item))+(item.goalTimeVerified?' · 確認済み':' · 仮設定')));
   const controls=make('div','goal-review-controls');
   const play=make('button','goal-review-play','▶ このゴールを映像で確認');
   play.type='button';play.addEventListener('click',()=>{void playAt(source,actualGoalTime(item));});
   controls.append(play);
   const keepClip=make('button','goal-review-keep-clip',
     '＋ このゴールを動画にキープ');
   keepClip.type='button';keepClip.disabled=!source.bins;
   keepClip.title=source.bins?'選択したゴールを通常のハイライト編集にも追加します':'通常のGemini見どころ解析の後に利用できます';
   keepClip.addEventListener('click',()=>{
    const added=onKeepClip(source,item);
    if(added)setStatus('ゴールシーンを動画のキープ済みに追加しました。ゴールの公式記録とは独立しています。');
   });
   controls.append(keepClip);card.append(controls);
   const inputs=make('div','goal-review-fields');
   const set=(fieldName,value)=>{
    if(String(item[fieldName]??'')===String(value??''))return;
    item[fieldName]=value;
    if(fieldName==='goalTimeSeconds')item.goalTimeVerified=false;
    if(item.status==='confirmed'){item.status='draft';item.confirmedAt=null;}
    write(source,items);render();
   };
   const timing=make('div','goal-review-time-adjust');
   const timingTitle=make('strong','', 'ゴール時刻を映像に合わせる');
   const minus=make('button','goal-review-adjust-button','−1秒');
   const plus=make('button','goal-review-adjust-button','＋1秒');
   const at=make('input','goal-review-time-input');
   at.type='number';at.step='0.1';at.min='0';
   at.value=String(actualGoalTime(item));at.setAttribute('aria-label','動画内のゴール時刻（秒）');
   const changeTime=val=>{
    const n=Number(val);
    if(!Number.isFinite(n)||String(val).trim()===''||n<0||(Number(source.duration)>0&&n>source.duration)){
     setStatus('動画内の有効なゴール時刻を入力してください。');return;
    }
    item.goalTimeSeconds=Math.round(n*10)/10;
    item.goalTimeVerified=false;
    if(item.status==='confirmed'){item.status='draft';item.confirmedAt=null;}
    write(source,items);render();
   };
   minus.type=plus.type='button';
   minus.addEventListener('click',()=>changeTime(Math.max(0,actualGoalTime(item)-1)));
   plus.addEventListener('click',()=>changeTime(actualGoalTime(item)+1));
   at.addEventListener('change',()=>changeTime(at.value));
   const timingHint=make('small','',
    '実況は得点から約5秒後。映像でプレーを見て、時刻を微調整してください。');
   timing.append(timingTitle,minus,at,plus,timingHint);
   card.append(timing);
   field(inputs,'得点者',item.scorer,v=>set('scorer',v),{placeholder:'例：若さん'});
   const assistField=make('label','goal-review-field');
   assistField.append(make('span','','アシストの状態'));
   const select=make('select','');
   for(const [value,label] of [['named','アシストあり'],['none','アシストなし'],['unknown','不明・未確認']]){
    const option=make('option','',label);option.value=value;select.append(option);
   }
   select.value=item.assistStatus||'unknown';
   select.addEventListener('change',()=>set('assistStatus',select.value));
   assistField.append(select);inputs.append(assistField);
   if(item.assistStatus==='named')
    field(inputs,'アシスト者',item.assist,v=>set('assist',v),{placeholder:'例：野田さん'});
   field(inputs,'対戦チーム',item.matchLabel,v=>set('matchLabel',v),{placeholder:'例：3と4'});
   field(inputs,'SS試合番号（任意）',item.matchSeq||'',v=>set('matchSeq',v),{type:'number',placeholder:'例：3'});
   field(inputs,'確認メモ（任意）',item.note||'',v=>set('note',v),{placeholder:'状況や確認事項',maxLength:400});
   card.append(inputs);
   const actions=make('div','goal-review-actions');
   const confirm=make('button','goal-review-confirm',item.status==='confirmed'?'✓ 確定済み':'このゴールを確定');
   confirm.type='button';
   confirm.disabled=item.status==='confirmed'||item.status==='excluded';
   confirm.addEventListener('click',()=>{
    const error=validateGoal(item);
    if(error){setStatus('確定できません：'+error);return;}
    item.status='confirmed';item.goalTimeVerified=true;
    item.confirmedAt=new Date().toISOString();
    write(source,items);render();setStatus('ゴールをPS内に確定・保存しました。SSアプリへはまだ登録していません。');
   });
   const exclude=make('button','goal-review-exclude',
    item.status==='excluded'?'除外を取り消す':item.origin==='manual'?'手動ゴールを削除':'ゴールではない／除外');
   exclude.type='button';
   exclude.addEventListener('click',()=>{
    if(item.origin==='manual'&&item.status!=='excluded'){
     const index=items.indexOf(item);
     items.splice(index,1);
    }else{
     item.status=item.status==='excluded'?'draft':'excluded';
     item.confirmedAt=null;
    }
    write(source,items);render();
   });
   actions.append(confirm,exclude);card.append(actions);rows.push(card);
  }
  list.replaceChildren(...rows);
 }
 sourcePicker.addEventListener('change',()=>{
  currentSelectedKey=sourcePicker.value;
  clearVideo();render();
 });
 addButton.addEventListener('click',()=>{
  const source=selectedSource();if(!source)return;
  const raw=window.prompt('追加するゴールの動画内時刻（例：06:19 または 379.2 秒）を入力してください。');
  if(raw===null)return;
  const m=String(raw).trim().match(/^(?:(\d+):)?(\d{1,2})(?:\.(\d+))?$/);
  let time=m?(m[1]?Number(m[1])*60+Number(m[2])+Number('0.'+(m[3]||'0')):Number(m[2])+Number('0.'+(m[3]||'0'))):Number(raw);
  if(!Number.isFinite(time)||time<0||time>36000){setStatus('時刻が不正です。例：06:19、379.2');return;}
  const data=allFor(source),item=makeManualGoal(time,source,store());
  data.items.push(item);write(source,data.items);render();
  openAt(source,time);
  setStatus('手動ゴールを追加しました。得点者を入力して映像を確認してください。');
 });
 function snapshot(){
  const exportData=confirmedGoalExport(sources(),store());
  return {text:JSON.stringify(exportData,null,2),filename:safeJsonFilename(),count:exportData.goals.length,
   missing:exportData.needsMatchSeq};
 }
 function reveal(text){
  textBox.hidden=false;textArea.value=text;showButton.textContent='JSONを閉じる';
 }
 exportButton.addEventListener('click',async()=>{
  const data=snapshot();if(!data.count){setStatus('まだ確定ゴールがありません。');return;}
  try{
   const shared=await shareCalloutJson(data.text,data.filename);
   if(shared==='completed')setStatus('共有画面を開きました。「ファイルに保存」を選んだ場合は保存先を確認してください。SSアプリには登録していません。');
   else if(shared==='cancelled')setStatus('共有をキャンセルしました。PS内の確定情報は残っています。');
   else{reveal(data.text);setStatus('共有非対応のためJSONを表示しました。コピーして保存できます。');}
  }catch(e){reveal(data.text);setStatus('共有に失敗：'+(e?.message||String(e))+'。JSONを表示しました。');}
 });
 copyButton.addEventListener('click',async()=>{
  const data=snapshot();if(!data.count)return;
  reveal(data.text);
  const copied=await copyCalloutJson(data.text,{textarea:textArea});
  setStatus(copied?'確定ゴールのJSONをコピーしました。SSアプリへは未送信です。':
   '自動コピーできませんでした。表示されたJSONを長押ししてコピーしてください。');
 });
 showButton.addEventListener('click',()=>{
  if(!textBox.hidden){textBox.hidden=true;showButton.textContent='JSONを表示';return;}
  reveal(snapshot().text);
 });
 function nearby(source,time,start,end){
  const events=allFor(source).items.filter(x=>x.status!=='excluded');
  return events.filter(item=>Math.abs(actualGoalTime(item)-Number(time))<=12 ||
    (actualGoalTime(item)>=Number(start)-2&&actualGoalTime(item)<=Number(end)+2));
 }
 function openAt(source,time){
  if(!source)return;
  currentSelectedKey=goalSourceKey(source);
  render();
  panel.open=true;
  const target=allFor(source).items
    .filter(x=>x.status!=='excluded').sort((a,b)=>Math.abs(actualGoalTime(a)-time)-Math.abs(actualGoalTime(b)-time))[0];
  const cards=[...list.querySelectorAll('.goal-review-card')];
  const card=cards.find(x=>x.dataset.goalId===target?.id);
  (card||panel).scrollIntoView({behavior:'smooth',block:'center'});
 }
 render();
 return {refresh:render,nearby,openAt};
}
