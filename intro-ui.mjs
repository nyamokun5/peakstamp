import { drawIntro, introTitleRect } from './exporter.mjs?v=scene15';
import { introPreset, overlayRect, normalizeIntroPoint, imageDimensions, prepareIntroPlan, introOverlayOpacity } from './intro-layout.mjs?v=scene15';

const $=id=>document.getElementById(id);
const fileSignature=f=>f?[f.name,f.size,f.lastModified]:null;
const state={
  presentation:'overlay',mode:'default',imageFile:null,backgroundImage:null,videoFile:null,
  overlayFile:null,overlayImage:null,position:{x:.5,y:.5},overlayScale:.6,
  imageUrl:null,videoUrl:null,overlayUrl:null,revision:0,
};
let onChange=()=>{},isBusy=()=>false,loadedAspectUrl=null,aspectVideo=null;
let playing=false,rafId=null,drag=null,previewStartedAt=0;
let firstSceneUrl=null,firstSceneStart=0,firstSceneOverlaySeconds=3,firstSceneZoom=1;
function showError(message){
  $('introError').textContent=message;
  $('introError').hidden=!message;
}
function info(){
  const overlay=state.presentation==='overlay';
  $('introCardBackgroundSettings').hidden=overlay;
  $('introDurationLabel').textContent=overlay?'先行再生＋タイトル3秒':'独立した5秒イントロ';
  $('introPreviewHelp').textContent=overlay
    ? '最初のシーンを最大3秒早く再生してタイトルを重ねます。プレビューはミュートですが、完成MP4では試合音声も再生されます。'
    : 'タイトルはドラッグして位置変更できます。背景動画の音声は使用しません。';
  for(const radio of document.querySelectorAll('input[name="introPresentation"]'))
    radio.checked=radio.value===state.presentation;
  $('introBackgroundName').textContent=state.mode==='default'?'デフォルトの背景を使用':
    state.mode==='image'?(state.imageFile?.name||'背景画像を選択してください'):
    (state.videoFile?.name||'背景動画を選択してください');
  $('introOverlayName').textContent=state.overlayFile?.name||'未設定：下のタイトル文字を使用';
  $('introOverlayClear').hidden=!state.overlayFile;
  $('introOverlayControls').hidden=!state.overlayImage;
  $('introPositionLabel').textContent=state.overlayImage
    ? 'PNGの位置（9か所・または指で自由に移動）'
    : 'タイトルの位置（9か所・または指で自由に移動）';
  $('introImagePicker').hidden=state.mode!=='image';
  $('introVideoPicker').hidden=state.mode!=='video';
  $('introPlay').hidden=!overlay&&state.mode!=='video';
  $('introPlay').textContent=overlay?'▶ 先頭3秒を再生':'▶ 5秒再生';
  $('introCanvas').classList.toggle('is-draggable',true);
  for(const radio of document.querySelectorAll('input[name="introBackgroundMode"]'))
    radio.checked=radio.value===state.mode;
}
function markChanged(){
  state.revision++;
  onChange();
}
export function getIntroConfiguration(){
  return {
    presentation:state.presentation,
    mode:state.mode,backgroundFile:state.mode==='video'?state.videoFile:null,
    backgroundImage:state.mode==='image'?state.backgroundImage:null,
    overlayImage:state.overlayImage,
    position:{...state.position},overlayScale:state.overlayScale
  };
}
export function getIntroSignature(){
  return {
    presentation:state.presentation,mode:state.mode,
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
  $('introFirstScenePreview').pause();
  $('introPlay').textContent=state.presentation==='overlay'?'▶ 先頭3秒を再生':'▶ 5秒再生';
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
  const prepared=prepareIntroPlan(plan,{presentation:'overlay'});
  const first=prepared.clips[0];
  const firstStart=first?.start??0;
  const firstEnd=prepared.overlaySeconds||0;
  const firstVideo=$('introFirstScenePreview');
  // Match the first clip's existing digital center zoom in the preview.
  firstSceneZoom=Math.max(1,Math.min(3,Number(first?.zoom)||1));
  firstVideo.style.transform='scale('+firstSceneZoom+')';
  firstVideo.style.transformOrigin='center center';
  if(firstSceneUrl!==url || firstSceneStart!==firstStart){
    stopPreview();
    firstSceneUrl=url;
    firstSceneStart=firstStart;
    firstSceneOverlaySeconds=firstEnd;
    if(url){
      firstVideo.src=url;
      firstVideo.onloadedmetadata=()=>{
        if(firstSceneUrl===url){
          firstVideo.currentTime=firstSceneStart;
          renderIntroPreview();
        }
      };
      firstVideo.load();
    }else firstVideo.removeAttribute('src');
  }else firstSceneOverlaySeconds=firstEnd;
  if(!url||loadedAspectUrl===url){
    renderIntroPreview();
    return;
  }
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
  const overlayMode=state.presentation==='overlay';
  const videoMode=!overlayMode&&state.mode==='video';
  $('introVideoPreview').hidden=!videoMode;
  $('introFirstScenePreview').hidden=!overlayMode;
  const options={
    font:$('titleFont').value||'impact',
    size:Number($('titleSize').value)||100,
    skipBackground:videoMode||overlayMode,
    backgroundImage:!overlayMode&&state.mode==='image'?state.backgroundImage:null,
    overlayImage:state.overlayImage,position:state.position,overlayScale:state.overlayScale
  };
  if(overlayMode && playing){
    const elapsed=Math.max(0,$('introFirstScenePreview').currentTime-firstSceneStart);
    ctx.globalAlpha=introOverlayOpacity(elapsed,firstSceneOverlaySeconds);
  }
  drawIntro(ctx,width,height,$('montageTitle').value||'GOALS!',options);
  ctx.globalAlpha=1;
}
async function loadImage(file){
  const url=URL.createObjectURL(file);
  const image=new Image();
  image.src=url;
  try{
    await new Promise((resolve,reject)=>{
      if(image.complete){
        if(image.naturalWidth){resolve();return;}
        reject(new Error('画像を開けません。別の画像を選択してください'));return;
      }
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
    if(isBusy())return;
    const p=pointerPosition(e,canvas);
    let hit;
    if(state.overlayImage){
      const dim=imageDimensions(state.overlayImage);
      const r=overlayRect(dim.width,dim.height,canvas.width,canvas.height,state.position,state.overlayScale);
      hit={left:r.x,top:r.y,width:r.width,height:r.height};
    }else{
      const ctx=canvas.getContext('2d');
      if(!ctx)return;
      hit=introTitleRect(ctx,canvas.width,canvas.height,
        $('montageTitle').value||'GOALS!',{
          font:$('titleFont').value,size:Number($('titleSize').value)||100,
          position:state.position
        });
    }
    // Generous hit target for small text on a touch screen.
    const pad=12;
    if(p.x*canvas.width<hit.left-pad||p.x*canvas.width>hit.left+hit.width+pad||
       p.y*canvas.height<hit.top-pad||p.y*canvas.height>hit.top+hit.height+pad)return;
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
  const overlay=state.presentation==='overlay';
  const duration=overlay?firstSceneOverlaySeconds:5;
  const video=overlay?$('introFirstScenePreview'):$('introVideoPreview');
  if(performance.now()-previewStartedAt>=duration*1000 ||
    (overlay&&video.currentTime>=firstSceneStart+duration)){
    stopPreview();
    if(overlay)video.currentTime=firstSceneStart;
    renderIntroPreview();return;
  }
  if(overlay)renderIntroPreview();
  rafId=requestAnimationFrame(tickPreview);
}
export function setIntroWorking(busy){
  for(const id of ['introImageFile','introVideoFile','introOverlayFile','introOverlayClear',
    'introOverlayScale','introPlay'])
    $(id).disabled=busy;
  for(const el of document.querySelectorAll('input[name="introBackgroundMode"], input[name="introPresentation"]'))
    el.disabled=busy;
  for(const el of document.querySelectorAll('[data-intro-position]'))el.disabled=busy;
}
export function initIntroEditor(callback,busy){
  onChange=callback||(()=>{});
  isBusy=busy||(()=>false);
  const video=$('introVideoPreview');
  video.muted=true;video.playsInline=true;
  const first=$('introFirstScenePreview');
  first.muted=true;first.playsInline=true;
  video.addEventListener('timeupdate',()=>{
    if(playing&&video.currentTime>=4.97){video.pause();}
  });
  for(const radio of document.querySelectorAll('input[name="introPresentation"]')){
    radio.addEventListener('change',()=>{
      if(!radio.checked||isBusy())return;
      stopPreview();state.presentation=radio.value;
      info();renderIntroPreview();markChanged();
    });
  }
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
    if(isBusy())return;
    const overlay=state.presentation==='overlay';
    if(overlay&&!firstSceneUrl)return;
    if(!overlay&&(state.mode!=='video'||!state.videoFile))return;
    stopPreview();
    const active=overlay?first:video;
    active.currentTime=overlay?firstSceneStart:0;
    try{
      await active.play();
      previewStartedAt=performance.now();playing=true;
      $('introPlay').textContent='再生中…';
      tickPreview();
    }catch(err){showError('イントロ動画を再生できません：'+(err?.message||String(err)));}
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
