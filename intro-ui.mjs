import { drawIntro } from './exporter.mjs?v=intro13';
import { introPreset, overlayRect, normalizeIntroPoint, imageDimensions } from './intro-layout.mjs?v=intro13';

const $=id=>document.getElementById(id);
const fileSignature=f=>f?[f.name,f.size,f.lastModified]:null;
const state={
  mode:'default',imageFile:null,backgroundImage:null,videoFile:null,
  overlayFile:null,overlayImage:null,position:{x:.5,y:.5},overlayScale:.6,
  imageUrl:null,videoUrl:null,overlayUrl:null,revision:0,
};
let onChange=()=>{},isBusy=()=>false,loadedAspectUrl=null,aspectVideo=null;
let playing=false,rafId=null,drag=null;
function showError(message){
  $('introError').textContent=message;
  $('introError').hidden=!message;
}
function info(){
  $('introBackgroundName').textContent=state.mode==='default'?'デフォルトの背景を使用':
    state.mode==='image'?(state.imageFile?.name||'背景画像を選択してください'):
    (state.videoFile?.name||'背景動画を選択してください');
  $('introOverlayName').textContent=state.overlayFile?.name||'未設定：下のタイトル文字を使用';
  $('introOverlayClear').hidden=!state.overlayFile;
  $('introOverlayControls').hidden=!state.overlayImage;
  $('introImagePicker').hidden=state.mode!=='image';
  $('introVideoPicker').hidden=state.mode!=='video';
  $('introPlay').hidden=state.mode!=='video';
  $('introCanvas').classList.toggle('is-draggable',!!state.overlayImage);
  for(const radio of document.querySelectorAll('input[name="introBackgroundMode"]'))
    radio.checked=radio.value===state.mode;
}
function markChanged(){
  state.revision++;
  onChange();
}
export function getIntroConfiguration(){
  return {
    mode:state.mode,backgroundFile:state.mode==='video'?state.videoFile:null,
    backgroundImage:state.mode==='image'?state.backgroundImage:null,
    overlayImage:state.overlayImage,
    position:{...state.position},overlayScale:state.overlayScale
  };
}
export function getIntroSignature(){
  return {
    mode:state.mode,
    bg:fileSignature(state.mode==='image'?state.imageFile:state.mode==='video'?state.videoFile:null),
    overlay:fileSignature(state.overlayFile),
    position:state.position,scale:state.overlayScale,revision:state.revision
  };
}
function stopPreview(){
  playing=false;
  if(rafId!==null)cancelAnimationFrame(rafId);
  rafId=null;
  const video=$('introVideoPreview');
  video.pause();
  $('introPlay').textContent='▶ 5秒再生';
}
function applyAspect(width,height){
  const ratio=width/height;
  if(!Number.isFinite(ratio)||ratio<=0)return;
  const canvas=$('introCanvas');
  const cw=ratio>=1?640:Math.round(480*ratio);
  const ch=ratio>=1?Math.round(640/ratio):480;
  canvas.width=Math.max(2,cw);
  canvas.height=Math.max(2,ch);
  $('introPreviewFrame').style.aspectRatio=cw+' / '+ch;
  renderIntroPreview();
}
export function refreshIntroAspect(activeState,plan){
  const id=plan?.[0]?.sourceId;
  const selected=activeState?.sources?.find(s=>s.id===id);
  const url=selected?.objectUrl||null;
  if(!url||loadedAspectUrl===url)return;
  loadedAspectUrl=url;
  if(!aspectVideo)aspectVideo=document.createElement('video');
  aspectVideo.preload='metadata';
  aspectVideo.onloadedmetadata=()=>{if(loadedAspectUrl===url)applyAspect(aspectVideo.videoWidth,aspectVideo.videoHeight);};
  aspectVideo.src=url;
  aspectVideo.load();
}
export function renderIntroPreview(){
  const canvas=$('introCanvas');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  if(!ctx)return;
  const width=canvas.width,height=canvas.height;
  ctx.clearRect(0,0,width,height);
  const videoMode=state.mode==='video';
  $('introVideoPreview').hidden=!videoMode;
  drawIntro(ctx,width,height,$('montageTitle').value||'GOALS!',{
    font:$('titleFont').value||'impact',
    size:Number($('titleSize').value)||100,
    skipBackground:videoMode,
    backgroundImage:state.mode==='image'?state.backgroundImage:null,
    overlayImage:state.overlayImage,position:state.position,overlayScale:state.overlayScale
  });
}
async function loadImage(file){
  const url=URL.createObjectURL(file);
  const image=new Image();
  image.src=url;
  try{
    await new Promise((resolve,reject)=>{
      if(image.complete&&image.naturalWidth){resolve();return;}
      image.onload=resolve;image.onerror=()=>reject(new Error('画像を開けません。別の画像を選択してください'));
    });
    const dim=imageDimensions(image);
    if(!dim.width||!dim.height||dim.width>10000||dim.height>10000)
      throw new Error('画像のサイズが大きすぎるか不正です');
    return {image,url};
  }catch(err){URL.revokeObjectURL(url);throw err;}
}
function refreshVideoPreview(){
  const video=$('introVideoPreview');
  stopPreview();
  video.src=state.videoUrl||'';
  if(state.videoUrl){
    video.currentTime=0;
    video.load();
  }else video.removeAttribute('src');
  renderIntroPreview();
}
async function chooseImage(file,kind){
  if(!file)return;
  if(isBusy())return;
  const isOverlay=kind==='overlay';
  const ok=isOverlay?/\.png$/i.test(file.name)||file.type==='image/png':
    /image\/(jpeg|png|webp)/.test(file.type)||/\.(jpe?g|png|webp)$/i.test(file.name);
  if(!ok){showError(isOverlay?'透過PNGを選択してください':'JPG・PNG・WebPを選択してください');return;}
  const limit=isOverlay?10:25;
  if(file.size>limit*1024*1024){showError('画像サイズは'+limit+'MB以下にしてください');return;}
  const changeId=++state.revision;
  try{
    const loaded=await loadImage(file);
    if(changeId!==state.revision){URL.revokeObjectURL(loaded.url);return;}
    if(isOverlay){
      if(state.overlayUrl)URL.revokeObjectURL(state.overlayUrl);
      state.overlayFile=file;state.overlayUrl=loaded.url;state.overlayImage=loaded.image;
    }else{
      if(state.imageUrl)URL.revokeObjectURL(state.imageUrl);
      state.imageFile=file;state.imageUrl=loaded.url;state.backgroundImage=loaded.image;
    }
    showError('');
    info();renderIntroPreview();markChanged();
  }catch(err){showError(err?.message||String(err));}
}
function chooseVideo(file){
  if(!file||isBusy())return;
  if(!(/video\//.test(file.type)||/\.(mp4|mov|m4v)$/i.test(file.name))){
    showError('MP4またはMOVの動画を選択してください');return;
  }
  if(file.size>300*1024*1024){showError('イントロ動画は300MB以下にしてください');return;}
  const url=URL.createObjectURL(file);
  if(state.videoUrl)URL.revokeObjectURL(state.videoUrl);
  state.videoFile=file;state.videoUrl=url;
  const video=$('introVideoPreview');
  video.onloadedmetadata=()=>{
    if(state.videoUrl!==url)return;
    if(!Number.isFinite(video.duration)||video.duration<=0)showError('背景動画の長さを取得できません');
    else showError('');
  };
  video.onerror=()=>showError('背景動画をプレビューできません。形式を確認してください');
  refreshVideoPreview();
  info();markChanged();
}
function applyPosition(point,commit=true){
  state.position=normalizeIntroPoint(point);
  for(const btn of document.querySelectorAll('[data-intro-position]')){
    const at=introPreset(Number(btn.dataset.introPosition));
    const selected=Math.abs(at.x-state.position.x)<.001&&Math.abs(at.y-state.position.y)<.001;
    btn.classList.toggle('active',selected);
    btn.setAttribute('aria-pressed',String(selected));
  }
  renderIntroPreview();
  if(commit)markChanged();
}
function pointerPosition(e,canvas){
  const rect=canvas.getBoundingClientRect();
  return {x:(e.clientX-rect.left)/rect.width,y:(e.clientY-rect.top)/rect.height};
}
function wireDrag(){
  const canvas=$('introCanvas');
  canvas.addEventListener('pointerdown',e=>{
    if(!state.overlayImage||isBusy())return;
    const p=pointerPosition(e,canvas),dim=imageDimensions(state.overlayImage);
    const r=overlayRect(dim.width,dim.height,canvas.width,canvas.height,state.position,state.overlayScale);
    if(p.x*canvas.width<r.x||p.x*canvas.width>r.x+r.width||
       p.y*canvas.height<r.y||p.y*canvas.height>r.y+r.height)return;
    drag={id:e.pointerId,start:p,position:{...state.position}};
    canvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.id)return;
    e.preventDefault();
    const p=pointerPosition(e,canvas);
    applyPosition({x:drag.position.x+(p.x-drag.start.x),
      y:drag.position.y+(p.y-drag.start.y)},false);
  });
  const finish=e=>{
    if(!drag||e.pointerId!==drag.id)return;
    canvas.releasePointerCapture?.(e.pointerId);
    drag=null;markChanged();
  };
  canvas.addEventListener('pointerup',finish);
  canvas.addEventListener('pointercancel',finish);
}
function tickPreview(){
  if(!playing)return;
  const video=$('introVideoPreview');
  if(video.currentTime>=5 || video.ended){
    stopPreview();renderIntroPreview();return;
  }
  // Background video is layered behind the transparent canvas. It plays
  // visibly using native browser media hardware rather than canvas redecoding.
  rafId=requestAnimationFrame(tickPreview);
}
export function setIntroWorking(busy){
  for(const id of ['introImageFile','introVideoFile','introOverlayFile','introOverlayClear',
    'introOverlayScale','introPlay'])
    $(id).disabled=busy;
  for(const el of document.querySelectorAll('input[name="introBackgroundMode"]'))
    el.disabled=busy;
  for(const el of document.querySelectorAll('[data-intro-position]'))el.disabled=busy;
}
export function initIntroEditor(callback,busy){
  onChange=callback||(()=>{});
  isBusy=busy||(()=>false);
  const video=$('introVideoPreview');
  video.muted=true;video.playsInline=true;
  video.addEventListener('timeupdate',()=>{
    if(playing&&video.currentTime>=4.97){stopPreview();renderIntroPreview();}
  });
  for(const radio of document.querySelectorAll('input[name="introBackgroundMode"]')){
    radio.addEventListener('change',()=>{
      if(!radio.checked||isBusy())return;
      stopPreview();state.mode=radio.value;
      info();renderIntroPreview();markChanged();
    });
  }
  $('introImageFile').addEventListener('change',e=>chooseImage(e.target.files?.[0],'background'));
  $('introVideoFile').addEventListener('change',e=>chooseVideo(e.target.files?.[0]));
  $('introOverlayFile').addEventListener('change',e=>chooseImage(e.target.files?.[0],'overlay'));
  $('introOverlayClear').addEventListener('click',()=>{
    if(isBusy())return;
    if(state.overlayUrl)URL.revokeObjectURL(state.overlayUrl);
    state.overlayFile=null;state.overlayUrl=null;state.overlayImage=null;
    $('introOverlayFile').value='';
    info();renderIntroPreview();markChanged();
  });
  for(const btn of document.querySelectorAll('[data-intro-position]')){
    btn.addEventListener('click',()=>{if(!isBusy())applyPosition(introPreset(Number(btn.dataset.introPosition)));});
  }
  $('introOverlayScale').addEventListener('input',()=>{
    state.overlayScale=Number($('introOverlayScale').value)/100;
    $('introScaleValue').textContent=$('introOverlayScale').value+'%';
    renderIntroPreview();
  });
  $('introOverlayScale').addEventListener('change',markChanged);
  $('introPlay').addEventListener('click',async()=>{
    if(state.mode!=='video'||!state.videoFile||isBusy())return;
    stopPreview();
    video.currentTime=0;
    try{await video.play();playing=true;$('introPlay').textContent='再生中…';tickPreview();}
    catch(err){showError('イントロ動画を再生できません：'+(err?.message||String(err)));}
  });
  window.addEventListener('pagehide',()=>{
    stopPreview();
    for(const url of [state.imageUrl,state.videoUrl,state.overlayUrl])if(url)URL.revokeObjectURL(url);
  });
  wireDrag();
  info();
  applyPosition({x:.5,y:.5},false);
  renderIntroPreview();
}
