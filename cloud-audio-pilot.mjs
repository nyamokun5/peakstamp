/**
 * Optional, one-video cloud-audio pilot.
 * PeakStamp uploads NOTHING; the user may manually upload exported M4A to AI Studio.
 */
import { discoverScenePool } from './ai-candidate-discovery.mjs?v=audio-pilot1';
import { createCloudAudioReviewPlayer } from './cloud-audio-review-player.mjs?v=1';
import { extractAudioOnly,formatFileSize } from './cloud-audio-export.mjs?v=1';
import { makeAudioAnalysisPrompt,parseAudioEvents,compareAudioCandidates,AUDIO_PROMPT_VERSION } from './cloud-audio-eval.mjs?v=3';

const $=id=>document.getElementById(id);
const node=(tag,txt)=>{const el=document.createElement(tag);if(txt!==undefined)el.textContent=txt;return el;};
const mmss=n=>{const x=Math.max(0,Math.floor(n||0));return Math.floor(x/60)+':'+String(x%60).padStart(2,'0');};
const LABELS=[['unreviewed','未評価'],['shot','シュート'],['goal','ゴール'],['save','GKセーブ'],['good','好プレー'],['ordinary','通常プレー'],['uncertain','判断できない']];
const TYPE_NAMES={goal_reaction:'ゴールへの反応',shot_reaction:'シュートへの反応',save_reaction:'GKセーブへの反応',excited_reaction:'盛り上がり',other:'その他の音',uncertain:'判定保留'};
let selected=0,sourceReady=null,exportedAudio=null,objectUrl=null;
let busy=false,jobId=0,result=null,ratings={};
let reviewPlayer=null,reviewSource=null,reviewEventSignature='';
const RATING_STORE='peakstamp_cloud_audio_ratings_v1';
const ratingKey=source=>[source?.file?.name||'',source?.file?.size||0,
 source?.file?.lastModified||0,Math.round((source?.duration||0)*1000)].join('|');
const ratedEventKey=event=>event.timeSeconds.toFixed(1)+'|'+event.type;
function readRatings(source,events){
 const restored={};
 try{
  const all=JSON.parse(localStorage.getItem(RATING_STORE)||'{}');
  const saved=all[ratingKey(source)]||{};
  for(const [i,event] of events.entries()){
   const value=saved[ratedEventKey(event)];
   if(LABELS.some(([label])=>label===value))restored[i]=value;
  }
 }catch(_){}
 return restored;
}
function saveRatings(source,events,labels){
 try{
  const all=JSON.parse(localStorage.getItem(RATING_STORE)||'{}');
  const key=ratingKey(source),saved=all[key]||{};
  for(const [i,event] of events.entries()){
   const value=labels[i];
   if(LABELS.some(([label])=>label===value))saved[ratedEventKey(event)]=value;
  }
  all[key]=saved;
  const keys=Object.keys(all);
  if(keys.length>30)for(const stale of keys.slice(0,keys.length-30))delete all[stale];
  localStorage.setItem(RATING_STORE,JSON.stringify(all));
 }catch(_){}
}
function discardReviewPlayer(){
 if(reviewPlayer){reviewPlayer.dispose();reviewPlayer=null;}
 reviewSource=null;reviewEventSignature='';
}
function available(state){return (state?.sources||[]).filter(x=>x?.file&&x?.objectUrl&&x?.bins?.length&&x?.duration>0);}
function currentSource(state){return available(state)[selected]||null;}
function say(message){const el=$('cloudAudioStatus');if(el)el.textContent=message;}
function sayCompare(message){const el=$('cloudAudioCompareStatus');if(el)el.textContent=message;}
function resetAudio(){
 jobId++;
 discardReviewPlayer();
 if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
 sourceReady=null;exportedAudio=null;result=null;ratings={};
 const ready=$('cloudAudioReady'),results=$('cloudAudioResults'),audio=$('cloudAudioPlayback');
 if(audio){audio.pause();audio.removeAttribute('src');audio.load();}
 if(ready)ready.hidden=true;
 if(results){results.replaceChildren();results.hidden=true;}
 const fallback=$('cloudAudioFallback');
 if(fallback){fallback.hidden=true;fallback.removeAttribute('href');}
 const txt=$('cloudAudioPaste');if(txt)txt.value='';
 sayCompare('');
}
export function refreshCloudAudioPilot(state){
 const picker=$('cloudAudioSourcePicker'),run=$('cloudAudioExtract'),compare=$('cloudAudioCompare'),copy=$('cloudAudioCopyPrompt');
 if(!picker||!run||!compare||!copy)return;
 const sources=available(state);
 const oldSource=sourceReady;
 const oldValue=picker.value;
 picker.replaceChildren();
 for(const [i,s] of sources.entries()){const option=node('option',s.file.name+'（'+mmss(s.duration)+'）');option.value=String(i);picker.append(option);}
 selected=sources.length?Math.min(selected,sources.length-1):0;
 // The calling app also refreshes this panel after each upload.
 if(oldValue!==''&&Number.isInteger(Number(oldValue))&&Number(oldValue)<sources.length)selected=Number(oldValue);
 picker.value=String(selected);
 const src=sources[selected]||null;
 if((oldSource && (!src||src.file!==oldSource.file)) || (reviewSource && (!src||src.file!==reviewSource.file))){resetAudio();say('動画が変わったため、音声を選び直してください。');}
 picker.disabled=busy||!sources.length;
 run.disabled=busy||state.working||state.exporting||!src;
 run.textContent=busy?'音声を抽出中…':'① 音声だけ取り出す';
 compare.disabled=busy||!src;
 copy.disabled=busy||!src;
}
async function clipboard(text,host){
 try{
  if(!navigator.clipboard?.writeText)throw Error('Clipboard API未対応');
  await navigator.clipboard.writeText(text);
  return true;
 }catch(_){
  const holder=host||$('cloudAudioPanel');
  const input=node('textarea');input.value=text;input.readOnly=true;input.rows=4;
  input.style.cssText='display:block;width:100%;max-width:100%;box-sizing:border-box;padding:8px;border-radius:8px;background:#f1f8fa;color:#123';
  holder.append(input);input.focus();input.select();
  try{return !!document.execCommand?.('copy')}catch(_){return false}
 }
}
function showExtracted(source,record){
 if(objectUrl)URL.revokeObjectURL(objectUrl);
 exportedAudio=record;sourceReady=source;objectUrl=URL.createObjectURL(record.blob);
 $('cloudAudioReady').hidden=false;
 $('cloudAudioPlayback').src=objectUrl;
 $('cloudAudioFileInfo').textContent='抽出完了：'+record.file.name+' ／ '+formatFileSize(record.bytes)+
  '（元動画'+formatFileSize(record.sourceBytes)+' → '+record.compressionRatio+'分の1、処理'+record.elapsedSeconds+'秒）';
 const link=$('cloudAudioFallback');link.href=objectUrl;link.download=record.file.name;link.hidden=false;
 say('音声ファイルを作りました。共有メニューから「ファイルに保存」を選択し、Google AI Studioにアップロードしてください。音声が再生できるかも確認してください。'+(record.warning||''));
}
async function extractSelected(state){
 const source=currentSource(state);
 if(!source||busy||state.working||state.exporting)return;
 busy=true;
 resetAudio();const expected=jobId;
 const mode=$('cloudAudioMode').value==='small'?'small':'fast';
 say('音声の準備中… 元動画はアップロードしません。');
 refreshCloudAudioPilot(state);
 try{
  const record=await extractAudioOnly(source.file,{mode,onProgress:p=>{
   if(expected===jobId)say('iPhone内で音声だけを処理しています：'+p+'%（動画のアップロードはありません）');
  },isCancelled:()=>expected!==jobId});
  if(expected!==jobId)throw Error('動画が変更されたため、抽出結果を破棄しました。');
  showExtracted(source,record);
 }catch(e){say('音声抽出に失敗：'+(e?.message||String(e))+'。高速・軽量モードを切り替えて再試行してください。');}
 finally{busy=false;refreshCloudAudioPilot(state);}
}
async function shareAudio(){
 if(!exportedAudio){say('先に音声を抽出してください。');return;}
 try{
  if(!navigator.share||(navigator.canShare&&!navigator.canShare({files:[exportedAudio.file]}))){
   say('音声ファイルの共有に対応していません。M4Aダウンロードをお試しください。');return;
  }
  await navigator.share({files:[exportedAudio.file],title:'PeakStamp 音声解析テスト'});
  say('iPhoneの共有画面を閉じました。「ファイルに保存」を選んだ場合はファイルアプリを確認してください。');
 }catch(e){say(e?.name==='AbortError'?'共有をキャンセルしました。':'共有に失敗：'+(e?.message||String(e)));}
}
function downloadAudio(){
 if(!exportedAudio){say('先に音声を抽出してください。');return;}
 const a=$('cloudAudioFallback');
 a.click();
 say('M4Aのダウンロードを試みました。保存できない場合は「ファイルに保存」の共有をお試しください。');
}
function selectPromptField(){
 const field=$('cloudAudioPromptText');
 const area=$('cloudAudioPromptArea');
 if(!field||!area||area.hidden||!field.value)return false;
 field.focus();
 field.select();
 try{field.setSelectionRange(0,field.value.length);}catch(_){}
 return true;
}
function copyPrompt(state){
 const area=$('cloudAudioPromptArea'),field=$('cloudAudioPromptText');
 const status=$('cloudAudioCopyStatus');
 const source=currentSource(state);
 if(!area||!field||!status)return;
 if(!source){
  area.hidden=false;
  status.textContent='まず動画を選び、通常の音声解析を実行してください。';
  return;
 }
 try{
  // The prompt is displayed and remains available regardless of clipboard permissions.
  // Do not await any async work before opening the fallback, especially on iOS Safari.
  field.value=makeAudioAnalysisPrompt(source.duration);
  area.hidden=false;
  status.textContent='解析指示を表示しました。コピーを試みています…';
  selectPromptField();
  // Legacy copy must run immediately during the trusted click gesture.
  let legacyCopied=false;
  try{legacyCopied=!!document.execCommand?.('copy');}catch(_){}
  if(legacyCopied){
   status.textContent='解析指示をコピーしました。Google AI Studioに貼り付けてください。';
   return;
  }
  // Also invoke modern Clipboard API directly in the click callback, not after an await.
  if(typeof navigator.clipboard?.writeText==='function'){
   let operation;
   try{operation=navigator.clipboard.writeText(field.value);}
   catch(_){operation=null;}
   if(operation&&typeof operation.then==='function'){
    operation.then(()=>{
     status.textContent='解析指示をコピーしました。Google AI Studioに貼り付けてください。';
    },()=>{
     status.textContent='iPhoneで自動コピーが許可されませんでした。すぐ上の指示文を長押ししてコピーしてください。「指示文を全選択する」も使えます。';
    });
    return;
   }
  }
  status.textContent='このブラウザでは自動コピーが利用できません。指示文を長押ししてコピーしてください。';
 }catch(e){
  area.hidden=false;
  status.textContent='指示文の準備に失敗：'+(e?.message||String(e));
 }
}
function summarizeRatings(){
 const selected=Object.values(ratings);
 return {reviewed:selected.filter(x=>x!=='unreviewed').length,
  shots:selected.filter(x=>['shot','goal','save'].includes(x)).length,
  good:selected.filter(x=>x==='good').length,
  ordinary:selected.filter(x=>x==='ordinary').length};
}
function exportReport(state){
 const source=currentSource(state);
 if(!source||!result)return null;
 return {
  tool:'PeakStamp Cloud Audio Pilot',
  exportedAt:new Date().toISOString(),
  promptVersion:AUDIO_PROMPT_VERSION,
  analysisMethod:'Manual M4A upload to Google AI Studio; model not verified by PeakStamp',
  video:{name:source.file.name,size:source.file.size,duration:source.duration},
  audioExport:exportedAudio?{bytes:exportedAudio.bytes,elapsedSeconds:exportedAudio.elapsedSeconds,
    mode:exportedAudio.mode,ratio:exportedAudio.compressionRatio}:null,
  comparison:result,
  ratings,
  ratingSummary:summarizeRatings(),
  caveat:'音声AIの反応と候補の時刻照合のみ。実際のシュート検出率ではない。'
 };
}
async function copyReport(state){
 const report=exportReport(state);
 if(!report)return;
 const text=JSON.stringify(report,null,2);
 const ok=await clipboard(text,$('cloudAudioResults'));
 sayCompare(ok?'評価レポートをコピーしました。このチャットに貼り付けてください。':'コピーできません。表示されたJSONを選択してコピーしてください。');
}
function showComparison(state,source){
 const host=$('cloudAudioResults');host.replaceChildren();host.hidden=false;
 const comp=result,stats=node('p','Geminiの音声反応候補 '+comp.total+'件 ／ PeakStamp通常候補と重複 '+
  comp.nearNormal+'件 ／ 広域探索の候補と重複 '+comp.nearBroad+'件 ／ 広域候補になかった新しい時刻 '+comp.outsideBroad+'件（±'+comp.toleranceSeconds+'秒で比較）');
 stats.style.cssText='font-size:13px;padding:9px;background:#1a4c57;color:#e7f5fb;border-radius:7px';
 host.append(stats);
 host.append(node('p','※ 音声AIが見つけたのは歓声・掛け声などの反応で、実際にシュートがあったことの証明ではありません。'));
 discardReviewPlayer();
 const rows=[];
 reviewPlayer=createCloudAudioReviewPlayer({source,events:comp.events,onChange:index=>{
  rows.forEach((row,i)=>{
   row.classList.toggle('cloud-audio-active-event',i===index);
   row.setAttribute('aria-current',i===index?'true':'false');
  });
 }});
 reviewSource=source;
 reviewEventSignature=comp.events.map(ratedEventKey).join(';');
 host.append(reviewPlayer.element);
 for(let i=0;i<comp.events.length;i++){
  const event=comp.events[i],row=node('div');
  rows.push(row);
  row.className='cloud-audio-event-row';
  row.style.cssText='padding:10px 0;border-bottom:1px solid #45657a';
  const title=node('strong',mmss(event.timeSeconds)+' ｜ '+(TYPE_NAMES[event.type]||event.type)+'（'+event.confidence+'）');
  title.style.cssText='display:block;font-size:13px';
  row.append(title);
  const detail=node('p',[event.quote,event.audibleClue].filter(Boolean).join(' — ')||'発話・音の説明なし');
  detail.style.cssText='font-size:12px;line-height:1.55';
  row.append(detail);
  const marker=node('small',event.additional?'新規：従来の広域候補なし':'既存音声候補と近い時刻');
  marker.style.cssText='color:'+(event.additional?'#ffd18c':'#a7ddc5');
  row.append(marker);
  const play=node('button','▶ '+mmss(event.clipStartSeconds)+'付近を元動画で確認');
  play.type='button';play.style.cssText='display:block;margin:8px 0;padding:9px;border-radius:7px;background:#285974;color:white;border:1px solid #699fa9';
  play.addEventListener('click',()=>reviewPlayer?.show(i));
  row.append(play);
  const label=node('label','確認結果：');
  label.style.cssText='font-size:12px;display:block';
  const picker=node('select');
  for(const [value,text] of LABELS){const option=node('option',text);option.value=value;picker.append(option);}
  picker.value=ratings[i]||'unreviewed';
  picker.addEventListener('change',()=>{ratings[i]=picker.value;saveRatings(source,comp.events,ratings);});
  label.append(picker);row.append(label);
  host.append(row);
 }
 const reportBtn=node('button','④ 評価レポートJSONをコピー');
 reportBtn.type='button';reportBtn.className='whisper-run';reportBtn.addEventListener('click',()=>copyReport(state));
 host.append(reportBtn);
 if(comp.events.length)reviewPlayer.show(0,{play:false});
}
function compare(state){
 const source=currentSource(state);
 if(!source){sayCompare('動画を読み込んで音声解析してください。');return;}
 try{
  const parsed=parseAudioEvents($('cloudAudioPaste').value,source.duration);
  const broad=discoverScenePool([source],{limit:20}).entries;
  result=compareAudioCandidates(parsed.events,source.candidates||[],broad,7);
  const sameSource=reviewSource?.file===source.file;
  const signature=result.events.map(ratedEventKey).join(';');
  if(!(sameSource&&signature===reviewEventSignature))ratings=readRatings(source,result.events);
  showComparison(state,source);
  sayCompare('解析結果を読み込みました：'+result.total+'件。'+
    (parsed.repairedNewlines>0?'Geminiが文章内に入れた改行 '+parsed.repairedNewlines+'か所を自動補正しました。':'')+
    'AIが新しく拾った場面を確認してください。');
 }catch(e){sayCompare('Geminiの回答を読み込めません：'+(e?.message||String(e)));}
}
export function initCloudAudioPilot(state){
 const ids=['cloudAudioSourcePicker','cloudAudioExtract','cloudAudioCopyPrompt','cloudAudioCompare'];
 if(ids.some(id=>!$(id)))return;
 $('cloudAudioSourcePicker').addEventListener('change',()=>{
  selected=Number($('cloudAudioSourcePicker').value)||0;
  if(!busy){resetAudio();say('動画を変更しました。');}
  refreshCloudAudioPilot(state);
 });
 $('cloudAudioExtract').addEventListener('click',()=>extractSelected(state));
 $('cloudAudioShare').addEventListener('click',shareAudio);
 $('cloudAudioDownload').addEventListener('click',downloadAudio);
 $('cloudAudioCopyPrompt').addEventListener('click',()=>copyPrompt(state));
 $('cloudAudioSelectPrompt').addEventListener('click',()=>{
  if(!selectPromptField())return;
  const status=$('cloudAudioCopyStatus');
  if(status)status.textContent='指示文を全選択しました。iPhoneでは選択部分を長押しして「コピー」を選んでください。';
 });
 $('cloudAudioCompare').addEventListener('click',()=>compare(state));
 refreshCloudAudioPilot(state);
}
