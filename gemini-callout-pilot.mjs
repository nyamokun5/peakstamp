/**
 * Opt-in commentary-transcription experiment.
 * Does not affect normal Gemini highlights, editing choices or official SS stats.
 */
import { openVideoWavSegmenter } from './gemini-wav-stream.mjs?v=1';
import { mergeCalloutSegments, formatCalloutTime } from './gemini-callouts.mjs?v=1';
import { WAV_SEGMENT_VERSION } from './gemini-wav-chunks.mjs?v=2';

const ENDPOINT='https://peakstamp-gemini-api.vercel.app/api/gemini-audio';
const CACHE_PREFIX='peakstamp_callout_pilot_v2:';
const $=id=>document.getElementById(id);
const signature=s=>[s?.file?.name||'',s?.file?.size||0,s?.file?.lastModified||0].join('::');
const cacheKey=(source,scope)=>CACHE_PREFIX+signature(source)+'::'+scope;
const chunkKey=(source,range)=>CACHE_PREFIX+'chunks:'+signature(source)+
 '::'+WAV_SEGMENT_VERSION+'::'+range.startSeconds+':'+range.durationSeconds;
function readChunk(source,range){
 try{
  const saved=JSON.parse(localStorage.getItem(chunkKey(source,range))||'null');
  return Array.isArray(saved?.utterances)?saved:null;
 }catch{return null;}
}
function saveChunk(source,range,response){
 try{localStorage.setItem(chunkKey(source,range),
  JSON.stringify({utterances:response.utterances}));}catch(_){}
}
function readCache(source,scope){
 try{const data=JSON.parse(localStorage.getItem(cacheKey(source,scope))||'null');
  return Array.isArray(data?.utterances)?data:null;
 }catch{return null;}
}
function saveCache(source,scope,value){
 try{localStorage.setItem(cacheKey(source,scope),JSON.stringify(value));}
 catch(_){/* Work without storage, e.g. Safari private mode. */}
}
const create=(name,cls,text)=>{
 const el=document.createElement(name);
 if(cls)el.className=cls;
 if(text!==undefined)el.textContent=text;
 return el;
};
function status(text){const el=$('calloutStatus');if(el)el.textContent=text;}
function setProgress(index,total){
 $('calloutProgress').hidden=false;
 $('calloutProgress').textContent='音声区間 '+index+' / '+total+' を確認中';
}
function downloadJson(payload,filename){
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=filename;
 document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
}

export function initGeminiCalloutPilot(state,{refreshGeminiPrimary=()=>{}}={}){
 const panel=$('geminiCalloutPanel');
 if(!panel)return;
 let running=false,controller=null,activeSource=null,lastKey='',activeResult=null;
 const sourcePicker=$('calloutSource');
 const scopePicker=$('calloutScope');
 const runButton=$('calloutRun');
 const rerunButton=$('calloutRerun');
 const stopButton=$('calloutStop');
 const exportButton=$('calloutExport');
 const list=$('calloutList');
 const preview=$('calloutPreview');
 const selection=()=>state.sources.filter(s=>s?.file&&s?.objectUrl);
 const picked=()=>selection()[Number(sourcePicker.value)||0]||null;
 const scope=()=>scopePicker.value==='whole'?'whole':'first';
 const resetPreview=()=>{
  preview.pause();
  if(preview.hasAttribute('src')){
   preview.removeAttribute('src');preview.load();
  }
  preview.hidden=true;preview.dataset.sourceId='';
 };
 function showResults(result,source,mode){
  list.replaceChildren();
  const savedRatings=result.ratings&&typeof result.ratings==='object'?result.ratings:{};
  const rows=result.utterances||[];
  if(!rows.length){
   list.append(create('p','fine-print','対象となる発話は検出されませんでした。「聞き逃しメモ」に手動で記録できます。'));
  }
  for(const [i,item] of rows.entries()){
   const card=create('div','callout-utterance');
   const header=create('div','callout-utterance-head');
   header.append(create('strong','',formatCalloutTime(item.time_seconds)+'  '+(item.kind==='match_start'?'試合開始':'ゴール宣言')));
   const play=create('button','callout-play','▶ この時刻を再生');
   play.type='button';
   play.addEventListener('click',async()=>{
    try{
     if(preview.dataset.sourceId!==source.id){
      resetPreview();preview.src=source.objectUrl;preview.dataset.sourceId=source.id;
      preview.preload='metadata';
     }
     preview.hidden=false;
     if(preview.readyState<1){
      await new Promise((resolve,reject)=>{
       const ready=()=>{cleanup();resolve();};
       const failed=()=>{cleanup();reject(Error('動画が再生できません。'))};
       const cleanup=()=>{preview.removeEventListener('loadedmetadata',ready);preview.removeEventListener('error',failed)};
       preview.addEventListener('loadedmetadata',ready);preview.addEventListener('error',failed);
       preview.load();
      });
     }
     preview.currentTime=Math.max(0,item.time_seconds-3);
     await preview.play();
    }catch(e){status('再生できませんでした：'+(e?.message||String(e))+'。Safariの再生ボタンもお試しください。')}
   });
   header.append(play);card.append(header);
   card.append(create('p','callout-quote','「'+item.quote+'」'));
   const facts=[];
   if(item.match_label)facts.push('対戦宣言：'+item.match_label);
   if(item.team_a||item.team_b)facts.push('チーム：'+[item.team_a||'不明',item.team_b||'不明'].join(' vs '));
   if(item.scorer)facts.push('得点者：'+item.scorer);
   if(item.assist)facts.push('アシスト：'+item.assist);
   if(facts.length)card.append(create('small','callout-fields',facts.join(' ／ ')));
   const check=create('div','callout-check');
   const label=create('label','','聞き取り評価');
   const select=create('select','callout-rating');
   const options=[['','未評価'],['correct','正しい'],['partial','一部違う'],['incorrect','誤認識']];
   for(const [value,text]of options){const opt=document.createElement('option');opt.value=value;opt.textContent=text;select.append(opt)}
   select.value=savedRatings[i]||'';
   select.addEventListener('change',()=>{
    if(!activeResult||activeResult!==result)return;
    result.ratings={...result.ratings,[i]:select.value};
    saveCache(source,mode,result);
   });
   label.append(select);check.append(label);card.append(check);
   list.append(card);
  }
  const counts=rows.reduce((acc,x)=>(acc[x.kind]=(acc[x.kind]||0)+1,acc),{});
  $('calloutCount').textContent='検出 '+rows.length+'件（試合開始 '+(counts.match_start||0)+'件／ゴール宣言 '+(counts.goal_call||0)+'件）';
  $('calloutMissed').value=result.missed||'';
  $('calloutResultArea').hidden=false;
  exportButton.disabled=false;
 }
 function refresh(){
  const sources=selection();
  panel.hidden=sources.length===0;
  const old=sourcePicker.value;
  sourcePicker.replaceChildren();
  for(const [i,s]of sources.entries()){
   const opt=document.createElement('option');opt.value=String(i);opt.textContent=s.file.name;sourcePicker.append(opt);
  }
  sourcePicker.value=sources.length?String(Math.max(0,Math.min(sources.length-1,Number(old)||0))):'';
  const source=picked(),mode=scope(),key=source?cacheKey(source,mode):'';
  const busy=running||state.working||state.exporting||state.geminiProcessing;
  sourcePicker.disabled=busy||sources.length<2;
  scopePicker.disabled=busy;
  runButton.disabled=busy||!source;
  rerunButton.disabled=busy||!source;
  const cached=source&&readCache(source,mode);
  rerunButton.hidden=!cached;
  runButton.textContent=cached?'保存済みの文字起こしを表示':'実況を文字で拾う（API料金あり）';
  stopButton.hidden=!running;
  if(key!==lastKey){
   resetPreview();
   lastKey=key;
   activeResult=cached;
   if(cached)showResults(cached,source,mode);
   else{
    $('calloutResultArea').hidden=true;
    $('calloutProgress').hidden=true;
    exportButton.disabled=true;
    status('');
   }
  }
 }
 async function run(force=false){
  const source=picked(),mode=scope();
  if(!source||running||state.working||state.exporting||state.geminiProcessing)return;
  const cached=readCache(source,mode);
  if(cached&&!force){
   activeResult=cached;showResults(cached,source,mode);
   status('保存済みの文字起こしを表示しました。Geminiへの再送信はありません。');
   return;
  }
  const access=$('geminiMainAccess')?.value?.trim();
  if(!access){status('上のGeminiアクセスコードを入力してください。');$('geminiMainAccess')?.focus();return;}
  if(!$('geminiMainConsent')?.checked){status('上の音声送信への同意をチェックしてください。');return;}
  if(!window.confirm((mode==='whole'
    ?'選択した動画の全区間を追加で解析します。区間ごとにAPI料金が発生します。'
    :'冒頭の最大70秒を追加で解析します。API料金が発生する場合があります。')+
    'この実験は通常のハイライト解析とは別で、SSアプリには登録されません。実行しますか？'))return;
  running=true;
  controller=new AbortController();
  activeSource=source;
  state.geminiProcessing=true;
  window.dispatchEvent(new Event('gemini-processing-state'));
  refreshGeminiPrimary(state);
  refresh();
  resetPreview();
  $('calloutResultArea').hidden=true;
  const signal=controller.signal;
  let segmenter=null;
  try{
   status('動画から音声を読み取っています。Safariを開いたままにしてください。');
   segmenter=await openVideoWavSegmenter(source.file,{isCancelled:()=>signal.aborted});
   if(signal.aborted)throw Error('中止しました。');
   const ranges=mode==='first'?segmenter.ranges.slice(0,1):segmenter.ranges;
   if(ranges.length>12)throw Error('この実験では最大10分の動画に対応します。');
   const responses=[];
   for(const [i,range] of ranges.entries()){
    if(signal.aborted)throw Error('中止しました。');
    setProgress(i+1,ranges.length);
    const previous=force?null:readChunk(source,range);
    if(previous){
     status('保存済み区間を再利用しています：'+(i+1)+'/'+ranges.length+' 区間');
     responses.push({...previous,startSeconds:range.startSeconds,durationSeconds:range.durationSeconds});
     continue;
    }
    status('試合開始とゴール宣言を文字起こししています：'+(i+1)+'/'+ranges.length+' 区間');
    const wav=await segmenter.makeSegment(range);
    if(signal.aborted)throw Error('中止しました。');
    if(wav.bytes>2_900_000)throw Error('WAVが送信容量上限を超えました。');
    const base64=await new Promise((resolve,reject)=>{
     const reader=new FileReader();
     reader.onload=()=>{const out=String(reader.result||'');const pos=out.indexOf(',');pos>=0?resolve(out.slice(pos+1)):reject(Error('WAVの読み込みに失敗しました。'));};
     reader.onerror=()=>reject(Error('WAVの読み込みに失敗しました。'));
     reader.readAsDataURL(wav.blob);
    });
    if(signal.aborted)throw Error('中止しました。');
    const response=await fetch(ENDPOINT,{method:'POST',mode:'cors',signal,
     headers:{'Content-Type':'application/json','X-PeakStamp-Access':access},
     body:JSON.stringify({mode:'callout-test',audioBase64:base64,
      durationSeconds:range.durationSeconds,audioFormat:'wav'})});
    const result=await response.json().catch(()=>null);
    if(!response.ok)throw Error(result?.error||'API応答エラー '+response.status);
    if(!Array.isArray(result?.utterances))throw Error('実況文字起こしの形式を読み取れませんでした。');
    if(signal.aborted)throw Error('中止しました。');
    saveChunk(source,range,result);
    responses.push({...result,startSeconds:range.startSeconds,durationSeconds:range.durationSeconds});
   }
   if(signal.aborted)throw Error('中止しました。');
   const combined=mergeCalloutSegments(responses,segmenter.durationSeconds);
   const result={kind:'peakstamp-callout-pilot',version:1,scope:mode,
    analyzedSeconds:mode==='first'?Math.min(70,segmenter.durationSeconds):segmenter.durationSeconds,
    createdAt:new Date().toISOString(),utterances:combined,ratings:{},missed:''};
   activeResult=result;
   saveCache(source,mode,result);
   showResults(result,source,mode);
   status('実験完了。'+combined.length+'件を検出しました。原動画と照らして正誤を記録できます。');
  }catch(e){
   if(signal.aborted)status('実況テストを中止しました。完了済み結果は変更されていません。');
   else status('実況テストのエラー：'+(e?.message||String(e)));
  }finally{
   try{await segmenter?.close();}catch(_){}
   running=false;controller=null;activeSource=null;
   state.geminiProcessing=false;
   window.dispatchEvent(new Event('gemini-processing-state'));
   refreshGeminiPrimary(state);
   refresh();
  }
 }
 sourcePicker.addEventListener('change',refresh);
 scopePicker.addEventListener('change',refresh);
 runButton.addEventListener('click',()=>run(false));
 rerunButton.addEventListener('click',()=>run(true));
 stopButton.addEventListener('click',()=>{controller?.abort();status('中止処理中…');});
 $('calloutMissed').addEventListener('change',()=>{
  if(!activeResult)return;
  const source=picked();if(!source)return;
  activeResult.missed=$('calloutMissed').value.slice(0,3000);
  saveCache(source,scope(),activeResult);
 });
 exportButton.addEventListener('click',()=>{
  const source=picked();
  if(!source||!activeResult)return;
  activeResult.missed=$('calloutMissed').value.slice(0,3000);
  saveCache(source,scope(),activeResult);
  downloadJson({...activeResult,source:{name:source.file.name,size:source.file.size,lastModified:source.file.lastModified}},
   'PeakStamp_Callout_Test_'+new Date().toISOString().slice(0,10)+'.json');
  status('音声の書き起こしと評価をJSONで保存しました。SSアプリには登録していません。');
 });
 window.addEventListener('gemini-processing-state',refresh);
 refresh();
 return {refresh};
}
