/**
 * Reusable, single-video reviewer for the Gemini comparison panel.
 * On a 500MB MOV, recreating the <video> on every candidate forces Safari
 * back through media initialization; keep ONE player and change currentTime.
 * Audio/video never leave the device from this module.
 */
const $make=(tag,text)=>{
 const el=document.createElement(tag);
 if(text!==undefined)el.textContent=text;
 return el;
};
const fmt=seconds=>{
 const n=Math.max(0,Math.floor(Number(seconds)||0));
 return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');
};
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export function createCloudAudioReviewPlayer({source,events,onChange=()=>{}}){
 if(!source?.objectUrl||!(source.duration>0))
  throw Error('確認動画の参照先がありません。音声解析をやり直してください。');
 const list=Array.isArray(events)?events:[];
 const root=$make('div');
 root.className='cloud-audio-player';
 root.id='cloudAudioVideoPreview';
 const top=$make('div');
 top.className='cloud-audio-player-top';
 const position=$make('strong','動画確認 — '+list.length+'候補');
 position.className='cloud-audio-player-title';
 const status=$make('span','確認したい候補を選択してください。');
 status.className='cloud-audio-player-status';
 status.setAttribute('role','status');
 status.setAttribute('aria-live','polite');
 top.append(position,status);
 root.append(top);
 const video=$make('video');
 video.controls=true;
 video.playsInline=true;
 video.preload='metadata';
 video.setAttribute('playsinline','');
 video.setAttribute('webkit-playsinline','');
 video.setAttribute('aria-label','Gemini候補を元動画で確認');
 video.className='cloud-audio-player-video';
 root.append(video);
 const nav=$make('div');
 nav.className='cloud-audio-player-nav';
 const previous=$make('button','◀ 前の候補');
 const next=$make('button','次の候補 ▶');
 const rewind=$make('button','−5秒');
 const resume=$make('button','▶ 再生');
 const forward=$make('button','＋5秒');
 for(const el of [previous,rewind,resume,forward,next]){
  el.type='button';
  el.className='cloud-audio-player-button';
  nav.append(el);
 }
 root.append(nav);
 const hint=$make('small','読み込みやシークに時間がかかる場合は、画面の「▶ 再生」を押してください。動画全体は再読み込みしません。');
 hint.className='cloud-audio-player-hint';
 root.append(hint);
 let active=-1,started=false,disposed=false,version=0;
 let currentRange=null,pending=null,playRequest=0;
 let resumeIntent=false;
 const updateButtons=()=>{
  previous.disabled=active<=0;
  next.disabled=active<0||active>=list.length-1;
  resume.textContent=video.paused?'▶ 再生':'⏸ 一時停止';
  rewind.disabled=active<0;forward.disabled=active<0;
  resume.disabled=active<0;
 };
 const setStatus=message=>{if(!disposed)status.textContent=message;};
 const markPosition=()=>{
  if(active<0){position.textContent='動画確認 — '+list.length+'候補';return;}
  const event=list[active];
  position.textContent='候補 '+(active+1)+'/'+list.length+'　'+fmt(event.timeSeconds)+' （反応時刻）';
 };
 const playVideo=()=>{
  if(disposed||active<0)return;
  const op=++playRequest;
  let promise;
  try{promise=video.play();}catch(_){
   setStatus('自動再生できませんでした。▶ 再生を押してください。');
   updateButtons();
   return;
  }
  if(promise&&typeof promise.then==='function'){
   promise.then(()=>{
    if(disposed||op!==playRequest)return;
    setStatus('再生中。候補を確認して評価を選んでください。');
    updateButtons();
   }).catch(()=>{
    if(disposed||op!==playRequest)return;
    setStatus('iPhoneで再生開始が制限されました。▶ 再生を押してください。');
    updateButtons();
   });
  }
  updateButtons();
 };
 function seekTo(target,{play=false,gesture=false}={}){
  if(disposed||active<0)return;
  const duration=Number.isFinite(video.duration)&&video.duration>0?video.duration:source.duration;
  const dest=clamp(Number(target)||0,0,Math.max(0,duration-.15));
  const id=++version;
  pending={id,target:dest,play};
  resumeIntent=!!play;
  playRequest++;
  try{video.pause()}catch(_){}
  setStatus(' '+fmt(dest)+' に移動しています…');
  updateButtons();
  if(!started){
   started=true;
   // Only set the MOV URL once; a new URL/object is NOT created per event.
   video.src=source.objectUrl;
   video.load();
  }
  if(video.readyState>=1)applyPending(gesture);
 }
 function applyPending(gesture=false){
  if(disposed||!pending||video.readyState<1)return;
  const request=pending;
  // Safari occasionally gets no seeked event when target=currentTime.
  const near=Math.abs((video.currentTime||0)-request.target)<.11&&!video.seeking;
  try{
   if(!near)video.currentTime=request.target;
   pending=null;
   if(near){
    setStatus('再生位置を準備しました。');
    if(request.play)playVideo();
   }else if(request.play&&gesture){
    // Safari usually accepts play when invoked in the original tap handler.
    // For a cold load, seeked will try again (or native ▶ remains available).
    playVideo();
   }
  }catch(e){
   if(!disposed)setStatus('この位置に移動できませんでした。もう一度候補を押してください。');
  }
 }
 const loaded=()=>{if(disposed)return;applyPending(false);};
 const seeked=()=>{
  if(disposed)return;
  if(resumeIntent&&video.paused)playVideo();
  else if(!video.paused)setStatus('再生中。候補を確認して評価を選んでください。');
  else setStatus('再生位置を準備しました。▶ 再生で確認できます。');
  updateButtons();
 };
 const onTime=()=>{
  if(disposed||!currentRange||video.paused)return;
  if(video.currentTime>=currentRange.end-.08){
   resumeIntent=false;
   try{video.pause()}catch(_){}
   setStatus('この候補の再生が終わりました。評価を選ぶか、次の候補へ進んでください。');
   updateButtons();
  }
 };
 const onError=()=>{
  if(!disposed)setStatus('元動画を再生できません。写真アプリでオリジナルを「ファイルに保存」して再度選択してください。');
 };
 const onPlaying=()=>{if(!disposed){setStatus('再生中。候補を確認して評価を選んでください。');updateButtons();}};
 const onPause=()=>{if(!disposed)updateButtons();};
 video.addEventListener('loadedmetadata',loaded);
 video.addEventListener('seeked',seeked);
 video.addEventListener('timeupdate',onTime);
 video.addEventListener('error',onError);
 video.addEventListener('playing',onPlaying);
 video.addEventListener('pause',onPause);
 function show(index,{play=true}={}){
  if(disposed||!list.length)return false;
  const nextIndex=clamp(Number(index)||0,0,list.length-1);
  active=nextIndex;
  const scene=list[active];
  const start=Number.isFinite(scene.clipStartSeconds)?scene.clipStartSeconds:scene.timeSeconds-8;
  const end=Number.isFinite(scene.clipEndSeconds)?scene.clipEndSeconds:scene.timeSeconds+5;
  currentRange={start:clamp(start,0,source.duration),end:clamp(end,0,source.duration)};
  if(currentRange.end<=currentRange.start)currentRange.end=Math.min(source.duration,currentRange.start+12);
  markPosition();
  onChange(active);
  seekTo(currentRange.start,{play,gesture:true});
  updateButtons();
  return true;
 }
 previous.addEventListener('click',()=>show(active-1));
 next.addEventListener('click',()=>show(active+1));
 rewind.addEventListener('click',()=>{
  if(active<0)return;
  seekTo((video.currentTime||currentRange.start)-5,{play:!video.paused,gesture:true});
 });
 forward.addEventListener('click',()=>{
  if(active<0)return;
  seekTo((video.currentTime||currentRange.start)+5,{play:!video.paused,gesture:true});
 });
 resume.addEventListener('click',()=>{
  if(active<0)return;
  if(video.paused){
   resumeIntent=true;
   if(pending&&video.readyState>=1)applyPending(true);
   playVideo();
  }else{
   resumeIntent=false;playRequest++;
   video.pause();setStatus('一時停止中。');
  }
  updateButtons();
 });
 updateButtons();
 function dispose(){
  if(disposed)return;
  disposed=true;version++;pending=null;resumeIntent=false;playRequest++;
  try{video.pause()}catch(_){}
  for(const [type,fn] of [['loadedmetadata',loaded],['seeked',seeked],['timeupdate',onTime],['error',onError],['playing',onPlaying],['pause',onPause]]){
   video.removeEventListener(type,fn);
  }
  video.removeAttribute('src');
  try{video.load()}catch(_){}
  root.remove();
 }
 return {element:root,show,dispose,get activeIndex(){return active;},video,status,controls:{previous,next,rewind,resume,forward}};
}
