/**
 * PeakStamp free, browser-local video exploration beta.
 * Phase 1: low resolution motion compensation on a single manually selected
 * sideline-phone recording. Phase 1 does NOT recognize ball, goal, or shots.
 */
import { discoverVideoMotionCandidates, VIDEO_SCAN_ALGORITHM } from './video-motion.mjs?v=3';
import { fileIdentity, parseShotTime, prettyShotTime, evaluateManualShots } from './shot-evaluation.mjs?v=1';
import { discoverScenePool } from './ai-candidate-discovery.mjs?v=2';

const $=id=>document.getElementById(id);
const LABEL_KEY='peakstamp_video_motion_labels_v1';
const TRUTH_KEY='peakstamp_manual_shot_times_v1';
const FRAME_WIDTH=96;
let feedback={},knownShots={},selectedIndex=0,working=false,interrupt=null,activeScanSource=null,lastScan=null,activePreview=null;
function readLocal(key){try{const item=JSON.parse(localStorage.getItem(key)||'{}');return item&&typeof item==='object'&&!Array.isArray(item)?item:{};}catch(_){return {};}}
feedback=readLocal(LABEL_KEY);knownShots=readLocal(TRUTH_KEY);
function save(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch(_){/* Safari storage disabled */}}
function node(tag,text){const element=document.createElement(tag);element.textContent=text||'';return element;}
function formatTime(t){return prettyShotTime(t);}
function cleanPreview(){
 if(!activePreview)return;
 try{activePreview.pause();activePreview.removeAttribute('src');activePreview.load();}catch(_){}
 activePreview=null;
}
function playable(source,t,container){
 cleanPreview();
 container.replaceChildren();
 if(!source?.objectUrl)return;
 const video=document.createElement('video');
 video.controls=true;video.playsInline=true;video.preload='metadata';video.setAttribute('playsinline','');
 video.style.cssText='display:block;width:100%;max-height:270px;background:#061523;border-radius:10px;margin:7px 0';
 video.src=source.objectUrl;
 container.append(video);
 activePreview=video;
 const seek=()=>{
  if(activePreview!==video)return;
  try{video.currentTime=Math.max(0,Math.min(source.duration-.3,t-7));}catch(_){}
 };
 video.addEventListener('loadedmetadata',seek,{once:true});
 if(video.readyState>=1)seek();
}
function throwIfCancelled(token){
 if(token.cancelled)throw Error('ユーザーが映像スキャンを停止しました');
}
function waitMedia(video,validEvents,token,timeout=15000){
 return new Promise((resolve,reject)=>{
  let finished=false;
  const settle=(error)=>{
   if(finished)return;
   finished=true;
   for(const event of validEvents)video.removeEventListener(event,onReady);
   video.removeEventListener('error',onError);
   clearTimeout(timer);
   error?reject(error):resolve();
  };
  const onReady=()=>settle();
  const onError=()=>settle(Error('動画を読み込めません。Safariが元動画のコーデックに対応していない可能性があります。'));
  for(const event of validEvents)video.addEventListener(event,onReady);
  video.addEventListener('error',onError);
  const timer=setTimeout(()=>settle(Error('映像フレームの読み込みがタイムアウトしました。短いMOVを選ぶか、標準モードを試してください。')),timeout);
  if(token.cancelled)settle(Error('停止しました'));
 });
}
async function sampleFrame(video,ctx,time,token){
 throwIfCancelled(token);
 const target=Math.min(Math.max(0,time),Math.max(0,video.duration-.09));
 // Safari can omit seeked for a no-op seek; skip setting the same time.
 if(video.readyState>=2&&!video.seeking&&Math.abs(video.currentTime-target)<.09){
   ctx.drawImage(video,0,0,ctx.canvas.width,ctx.canvas.height);
 }else{
   const awaited=waitMedia(video,['seeked'],token,13000);
   try{video.currentTime=target;}catch(e){awaited.catch(()=>{});throw e;}
   await awaited;
   if(video.readyState<2)await waitMedia(video,['loadeddata','canplay'],token,9000);
   throwIfCancelled(token);
   ctx.drawImage(video,0,0,ctx.canvas.width,ctx.canvas.height);
 }
 const {data}=ctx.getImageData(0,0,ctx.canvas.width,ctx.canvas.height);
 const luma=new Uint8Array(ctx.canvas.width*ctx.canvas.height);
 // Gamma-compressed video: approximate luminance is sufficient for alignment.
 for(let p=0,i=0;p<luma.length;p++,i+=4){
   luma[p]=(77*data[i]+150*data[i+1]+29*data[i+2])>>>8;
 }
 return {time:target,width:ctx.canvas.width,height:ctx.canvas.height,luma};
}
async function scanVideo(source,mode,notify,token){
 let video=null;
 try{
  video=document.createElement('video');
  video.muted=true;
  video.playsInline=true;
  video.setAttribute('playsinline','');
  video.preload='auto';
  video.style.cssText='position:fixed;left:-200px;top:-200px;width:2px;height:2px;opacity:0.001;pointer-events:none;z-index:-1';
  document.body.append(video);
  const metadata=waitMedia(video,['loadedmetadata'],token,25000);
  video.src=source.objectUrl;
  video.load();
  await metadata;
  throwIfCancelled(token);
  if(!(video.duration>0)||!(video.videoWidth>0)||!(video.videoHeight>0)){
    throw Error('映像の長さや画角を読み込めませんでした');
  }
  const duration=Math.min(source.duration||video.duration,video.duration);
  const maxFrames=mode==='detail'?280:150;
  const interval=Math.max(mode==='detail'?.9:1.8,duration/Math.max(2,maxFrames-1));
  const count=Math.min(maxFrames,Math.max(2,Math.ceil((duration-.3)/interval)));
  const canvas=document.createElement('canvas');
  canvas.width=FRAME_WIDTH;
  canvas.height=Math.max(36,Math.min(96,Math.round(FRAME_WIDTH*video.videoHeight/video.videoWidth)));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw Error('iPhoneのCanvasを初期化できませんでした');
  const frames=[];
  for(let i=0;i<count;i++){
    throwIfCancelled(token);
    const time=Math.min(duration-.10,.12+i*interval);
    try{
      frames.push(await sampleFrame(video,ctx,time,token));
    }catch(e){
      if(token.cancelled)throw e;
      // If one seek fails, stop instead of silently skipping many samples.
      throw Error('映像 '+formatTime(time)+' の取得に失敗しました：'+(e?.message||String(e)));
    }
    if(i===0||i%4===0||i===count-1)notify(i+1,count,time);
    // Yield the main UI thread before the next seek.
    if(i%8===0)await new Promise(r=>setTimeout(r,0));
  }
  // Pure JS, in-memory luminance only. No network transport of video.
  const result=discoverVideoMotionCandidates(frames,{
    maxResults:12,minGapSeconds:9
  });
  return {result,frames:frames.length,interval,videoWidth:video.videoWidth,videoHeight:video.videoHeight,
    duration,algorithm:VIDEO_SCAN_ALGORITHM};
 } finally {
  if(video){
    try{video.pause();video.removeAttribute('src');video.load();video.remove();}catch(_){}
  }
 }
}
function currentSource(state){
 const sources=(state.sources||[]).filter(s=>s?.bins?.length && s?.objectUrl && s.duration>0);
 if(selectedIndex>=sources.length)selectedIndex=0;
 return sources[selectedIndex]||null;
}
function saveLabel(candidate,value){
 if(value==='unreviewed')delete feedback[candidate.key];
 else feedback[candidate.key]=value;
 save(LABEL_KEY,feedback);
 updateSummary();
}
function labelSelect(candidate){
 const sel=document.createElement('select');
 sel.setAttribute('aria-label',candidate.fileName+' '+formatTime(candidate.peakSeconds)+' の映像評価');
 sel.style.cssText='width:100%;padding:10px;border-radius:8px;background:#e6f1f9;color:#112b3e;min-height:42px';
 for(const [value,text]of [
  ['unreviewed','未評価'],['shot','実際にシュート'],['goal','ゴール'],['save','GKセーブ'],['good','その他の好プレー'],
  ['ordinary','通常プレー'],['not-visible','画角外・判断不能']]){
  const opt=node('option',text);opt.value=value;sel.append(opt);
 }
 sel.value=feedback[candidate.key]||'unreviewed';
 sel.addEventListener('change',()=>saveLabel(candidate,sel.value));
 return sel;
}
function makeCard(candidate,index,oldPool){
 const container=node('div');
 container.style.cssText='border:1px solid #416a78;background:#0a2638;padding:12px;border-radius:12px;margin:10px 0';
 const title=node('strong',(index+1)+'. '+candidate.fileName+' '+formatTime(candidate.peakSeconds));
 title.style.cssText='font-size:14px;display:block;color:#95e4cd';
 container.append(title);
 const matched=oldPool.some(x=>Math.abs(x.peakSeconds-candidate.peakSeconds)<5 && x.sourceId===candidate.sourceId);
 const note=node('p',matched?'音声の広域候補にも近い場面があります':'音声の広域候補外から見つけた場面です');
 note.style.cssText='font-size:12px;color:'+(matched?'#d6d6c6':'#8feccc');
 container.append(note);
 const limited=candidate.detail.alignmentLimited===true;
 const details=node('p','映像変化スコア '+candidate.score.toFixed(2)+
    ' ／ 相対変化量 '+candidate.detail.residual.toFixed(2)+
    ' ／ 元の差分値 '+(candidate.detail.rawResidual??0).toFixed(1)+
    ' ／ 推定カメラ移動 '+candidate.detail.cameraDx+'px'+
    ' ／ 補正の信頼度 '+candidate.detail.cameraConfidence.toFixed(2)+
    (limited?' ／ ⚠ カメラ移動が補正範囲の限界に達した可能性あり':''));

 details.style.cssText='font-size:12px;line-height:1.7;color:#bfd7e5';
 container.append(details);
 const host=node('div');
 const play=node('button','▶ 映像で確認');
 play.type='button';play.className='video-explore-play';
 play.style.cssText='width:100%;padding:10px;border-radius:8px;background:#245f68;color:white;border:1px solid #67bcb2';
 play.addEventListener('click',()=>{
  if(host.firstChild){cleanPreview();host.replaceChildren();}
  else playable(candidate.source,candidate.peakSeconds,host);
 });
 container.append(play,host);
 const label=node('label','実際のプレーを評価');
 label.style.cssText='display:block;margin:10px 0 5px;font-size:12px;color:#d5e7f1';
 container.append(label,labelSelect(candidate));
 return container;
}
function updateSummary(){
 const el=$('videoExploreMetrics');
 if(!el)return;
 if(!lastScan){el.textContent='映像をスキャンすると候補と比較結果が表示されます。';return;}
 const annotated=lastScan.candidates.filter(x=>feedback[x.key]&&feedback[x.key]!=='unreviewed');
 const actual=annotated.filter(x=>['shot','goal','save'].includes(feedback[x.key])).length;
 const reviewed=annotated.filter(x=>feedback[x.key]!=='not-visible').length;
 const source=lastScan.source;
 const times=knownShots[fileIdentity(source.file)]||[];
 const broad=discoverScenePool([source],{limit:20}).entries;
 const truth=evaluateManualShots([source],{[fileIdentity(source.file)]:times},
   lastScan.candidates.map(x=>({...x,sourceId:source.id})),
   broad.map(x=>({...x,sourceId:source.id})),5);
 el.textContent='映像候補の評価：'+annotated.length+'件入力・うちシュート／ゴール／セーブ '+actual+
   '件（判断可能 '+reviewed+'件）。手入力の実際のシュート '+truth.summary.annotated+
   '件のうち、映像探索と±5秒一致 '+truth.summary.wideFound+
   '件、音声広域探索と一致 '+truth.summary.impulseFound+'件。'+
   (truth.summary.annotated?' ※これは時刻の近さによる比較です。':'');
}
function renderGroundTruth(source){
 const form=$('videoGroundTruth');
 const list=$('videoGroundTruthList');
 if(!form||!list)return;
 form.hidden=!source;
 list.replaceChildren();
 if(!source)return;
 const times=[...(knownShots[fileIdentity(source.file)]||[])].sort((a,b)=>a-b);
 if(!times.length){list.append(node('p','実際のシュート時刻を入力すると、見逃しの比較ができます。'));return;}
 for(const t of times){
  const row=node('div');
  row.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px;margin:6px 0';
  row.append(node('span','⚽ '+formatTime(t)));
  const del=node('button','削除');
  del.type='button';
  del.style.cssText='padding:6px 9px;border-radius:6px;border:1px solid #56788a;background:#17364b;color:#fff';
  del.addEventListener('click',()=>{
    const key=fileIdentity(source.file);
    knownShots[key]=(knownShots[key]||[]).filter(x=>x!==t);
    save(TRUTH_KEY,knownShots);
    renderGroundTruth(source);updateSummary();
  });
  row.append(del);list.append(row);
 }
}
function renderResults(){
 const target=$('videoExploreResults');
 if(!target)return;
 cleanPreview();target.replaceChildren();
 if(!lastScan){target.hidden=true;return;}
 target.hidden=false;
 const {source,candidates,metadata}=lastScan;
 const heading=node('div','映像探索：'+candidates.length+'件の候補');
 heading.style.cssText='font-size:16px;font-weight:800;color:#8feccc;padding:8px 0';
 target.append(heading);
 const quality=metadata.motionSummary||{};
 const overview=node('p','低解像度 '+metadata.frames+'フレームを約'+metadata.interval.toFixed(1)+
    '秒間隔で比較。映像変化は動画ごとに相対評価し、カメラ移動が補正範囲に達した場合は信頼度を下げています。'+
    '補正範囲に達したフレームペア：'+(quality.alignmentLimitedPairs??'不明')+'/'+(quality.compared??'不明')+
    '。シュート・ゴールを映像AIで識別した結果ではありません。');
 overview.style.cssText='font-size:12px;color:#c6dbe9;line-height:1.6';
 target.append(overview);
 const metrics=node('p');metrics.id='videoExploreMetrics';
 metrics.style.cssText='font-size:13px;color:#cfe9eb;padding:8px;background:#163d4f;border-radius:8px';
 target.append(metrics);
 const original=discoverScenePool([source],{limit:20}).entries;
 if(!candidates.length){
  target.append(node('p','目立つカメラ・映像変化は検出されませんでした。映像が静かなシュートは見逃す場合があります。'));
 }
 for(let i=0;i<Math.min(5,candidates.length);i++)target.append(makeCard(candidates[i],i,original));
 if(candidates.length>5){
  const more=node('details');
  more.style.cssText='padding:10px;margin:8px 0;border:1px solid #416a78;border-radius:10px';
  more.append(node('summary','さらに映像候補 '+(candidates.length-5)+'件を確認'));
  for(let i=5;i<candidates.length;i++)more.append(makeCard(candidates[i],i,original));
  target.append(more);
 }
 const saveButton=node('button','映像探索と正解時刻をJSONで保存');
 saveButton.type='button';
 saveButton.style.cssText='width:100%;padding:12px;margin:10px 0;border-radius:8px;background:#195e52;color:#fff;border:1px solid #76cbb6';
 saveButton.addEventListener('click',exportResults);
 target.append(saveButton);
 updateSummary();
}
function exportResults(){
 if(!lastScan)return;
 const {source,candidates,metadata}=lastScan;
 const payload={
  tool:'PeakStamp Video Explore β',
  exportedAt:new Date().toISOString(),
  algorithm:VIDEO_SCAN_ALGORITHM,
  warning:'ヒトが評価する映像変化候補。ボール・ゴール・シュートの視覚認識モデルではない。',
  video:{name:source.file.name,size:source.file.size,duration:source.duration,
    mode:metadata.mode,frames:metadata.frames,interval:metadata.interval,
    videoWidth:metadata.videoWidth,videoHeight:metadata.videoHeight},
  motionSummary:metadata.motionSummary||{},
  motionTimeline:metadata.motionTimeline||[],
  candidates:candidates.map(x=>({
    timeSeconds:x.peakSeconds,score:x.score,detail:x.detail,
    userLabel:feedback[x.key]||'unreviewed'
  })),
  manuallyMarkedShotTimes:knownShots[fileIdentity(source.file)]||[],
  note:'動画の実データはJSONに含まれない'
 };
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a');
 a.href=url;a.download='PeakStamp-Video-Explore.json';
 document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),15000);
}
export function refreshVideoExplore(state){
 const sources=(state.sources||[]).filter(s=>s?.bins?.length && s?.objectUrl && s.duration>0);
 const picker=$('videoSourcePicker'),button=$('videoExploreButton'),cancel=$('videoExploreCancel');
 if(!picker||!button||!cancel)return;
 const prev=picker.value;
 picker.replaceChildren();
 sources.forEach((src,i)=>{
  const opt=node('option',src.file.name+'（'+formatTime(src.duration)+'）');
  opt.value=String(i);picker.append(opt);
 });
 const chosen=(prev!=='' && Number(prev)<sources.length && Number(prev)>=0)?Number(prev):Math.min(selectedIndex,Math.max(0,sources.length-1));
 selectedIndex=chosen;picker.value=String(chosen);
 const source=sources[chosen]||null;
 if(working&&(!source || activeScanSource?.objectUrl!==source.objectUrl)&&interrupt)interrupt.cancelled=true;
 picker.disabled=working||!sources.length;
 button.disabled=working||state.working||state.exporting||!source;
 button.textContent=working?'映像スキャン中…':'この動画を映像で探索';
 cancel.hidden=!working;
 $('videoExploreHelp').textContent=source
  ? '対象：'+source.file.name+'。標準で最大150フレーム、詳細で最大280フレーム。長い動画ほど間引いて処理します。'
  : 'まず動画を追加し、音声解析を実行してください。';
 if(lastScan&&(!source||source.objectUrl!==lastScan.source.objectUrl)){
   lastScan=null;renderResults();
 }
 renderGroundTruth(source);
 updateSummary();
}
export function initVideoExplore(state){
 const picker=$('videoSourcePicker'),button=$('videoExploreButton'),cancel=$('videoExploreCancel');
 if(!picker||!button||!cancel)return;
 picker.addEventListener('change',()=>{
  selectedIndex=Number(picker.value)||0;lastScan=null;renderResults();
  refreshVideoExplore(state);
 });
 cancel.addEventListener('click',()=>{if(interrupt)interrupt.cancelled=true;$('videoExploreStatus').textContent='停止処理中…';});
 $('videoGroundTruthSave').addEventListener('click',()=>{
  const source=currentSource(state);
  if(!source)return;
  const input=$('videoGroundTruthInput');
  const values=input.value.split(/[、,\n\s]+/u).map(x=>x.trim()).filter(Boolean);
  const times=values.map(parseShotTime);
  if(!values.length||times.some(x=>x===null||x>=source.duration)){
    $('videoExploreStatus').textContent='時刻形式を確認してください。例：01:28, 04:39.5。動画の長さ以内で入力してください。';
    return;
  }
  const key=fileIdentity(source.file);
  const merged=[...(knownShots[key]||[]),...times];
  knownShots[key]=[...new Set(merged)].sort((a,b)=>a-b).slice(0,100);
  save(TRUTH_KEY,knownShots);
  input.value='';
  renderGroundTruth(source);updateSummary();
  $('videoExploreStatus').textContent='実際のシュート時刻 '+times.length+'件を保存しました。';
 });
 button.addEventListener('click',async()=>{
  const source=currentSource(state);
  if(working||state.working||state.exporting||!source)return;
  working=true;interrupt={cancelled:false};activeScanSource=source;
  const token=interrupt;
  lastScan=null;renderResults();refreshVideoExplore(state);
  const mode=$('videoExploreMode').value==='detail'?'detail':'standard';
  $('videoExploreStatus').textContent='映像を読み込んでいます。iPhoneで初回は時間がかかる場合があります。';
  try{
    const metadata=await scanVideo(source,mode,(done,total,time)=>{
      $('videoExploreStatus').textContent='映像フレーム '+done+'/'+total+'（'+formatTime(time)+
       '）を確認中。処理中はSafariを閉じないでください。';
    },token);
    throwIfCancelled(token);
    if(!state.sources.some(s=>s===source&&s.objectUrl===source.objectUrl))throw Error('途中で動画が変更されました');
    const candidates=metadata.result.candidates.map(item=>({
      ...item,fileName:source.file.name,source,sourceId:source.id,
      key:[source.file.name,source.file.size,source.file.lastModified,
        Math.round(item.peakSeconds*1000),'video-motion'].join('::')
    }));
    lastScan={source,candidates,metadata:{
      frames:metadata.frames,interval:metadata.interval,
      videoWidth:metadata.videoWidth,videoHeight:metadata.videoHeight,
      duration:metadata.duration,mode,
      motionSummary:metadata.result.summary,
      motionTimeline:metadata.result.measurements
    }};
    renderResults();
    $('videoExploreStatus').textContent='映像探索完了：'+candidates.length+
      '件の映像変化候補を発見。シュートかどうかは再生して評価してください。';
  }catch(e){
    $('videoExploreStatus').textContent=(token.cancelled?'映像探索を停止しました。':'映像スキャン失敗：'+String(e?.message||e));
    lastScan=null;renderResults();
  }finally{
    working=false;interrupt=null;activeScanSource=null;refreshVideoExplore(state);
  }
 });
 refreshVideoExplore(state);
}
