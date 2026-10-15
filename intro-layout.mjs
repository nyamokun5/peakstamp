/**
 * Pure intro layout geometry shared by the export pipeline and preview.
 * All coordinates are normalized to the visible output canvas (0 to 1).
 */
export const INTRO_ANCHORS=Object.freeze([
  ['左上',.18,.18],['上中央',.5,.18],['右上',.82,.18],
  ['左中央',.18,.5],['中央',.5,.5],['右中央',.82,.5],
  ['左下',.18,.82],['下中央',.5,.82],['右下',.82,.82]
]);
export const INTRO_SECONDS=5;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export function normalizeIntroPoint(point){
  return {x:clamp(Number.isFinite(Number(point?.x))?Number(point.x):.5,0,1),
    y:clamp(Number.isFinite(Number(point?.y))?Number(point.y):.5,0,1)};
}
export function introPreset(index){
  const a=INTRO_ANCHORS[Number(index)]||INTRO_ANCHORS[4];
  return {x:a[1],y:a[2]};
}
export function coverRect(sourceWidth,sourceHeight,width,height){
  if(![sourceWidth,sourceHeight,width,height].every(x=>Number.isFinite(x)&&x>0))
    throw new Error('画像または動画のサイズが不正です');
  const scale=Math.max(width/sourceWidth,height/sourceHeight);
  const w=sourceWidth*scale,h=sourceHeight*scale;
  return {x:(width-w)/2,y:(height-h)/2,width:w,height:h};
}
export function overlayRect(sourceWidth,sourceHeight,width,height,point={x:.5,y:.5},size=.6){
  if(![sourceWidth,sourceHeight,width,height].every(x=>Number.isFinite(x)&&x>0))
    throw new Error('透過PNGのサイズが不正です');
  const normalized=normalizeIntroPoint(point);
  const magnification=clamp(Number.isFinite(Number(size))?Number(size):.6,.2,1);
  // Fit within 90% of the canvas even for unusually tall PNGs.
  const scale=Math.min(width*magnification/sourceWidth,height*.9/sourceHeight);
  const w=sourceWidth*scale,h=sourceHeight*scale;
  const cx=clamp(normalized.x*width,w/2,width-w/2);
  const cy=clamp(normalized.y*height,h/2,height-h/2);
  return {x:cx-w/2,y:cy-h/2,width:w,height:h};
}
export function imageDimensions(image){
  return {
    width: image?.naturalWidth||image?.videoWidth||image?.width||0,
    height:image?.naturalHeight||image?.videoHeight||image?.height||0
  };
}
export function drawCover(context,image,width,height){
  const dim=imageDimensions(image);
  const rect=coverRect(dim.width,dim.height,width,height);
  context.drawImage(image,rect.x,rect.y,rect.width,rect.height);
}
export function drawIntroOverlay(context,image,width,height,point,size){
  const dim=imageDimensions(image);
  const rect=overlayRect(dim.width,dim.height,width,height,point,size);
  context.drawImage(image,rect.x,rect.y,rect.width,rect.height);
  return rect;
}

/** Intro overlays use the first highlight's own video; no separate card time. */
export const FIRST_SCENE_LEAD_SECONDS=3;
export function prepareIntroPlan(plan,intro=null){
  const clips=(plan||[]).map(c=>({...c}));
  if(!clips.length)return {clips,introSeconds:0,overlaySeconds:0,prerollSeconds:0};
  if(intro?.presentation!=='overlay')
    return {clips,introSeconds:INTRO_SECONDS,overlaySeconds:0,prerollSeconds:0};
  const originalStart=Math.max(0,Number(clips[0].start)||0);
  const previous=Math.max(0,originalStart-FIRST_SCENE_LEAD_SECONDS);
  clips[0].start=previous;
  const prerollSeconds=originalStart-previous;
  // If a scene begins before 3 seconds into its original video, keep showing
  // the title over its opening frames rather than making it disappear.
  const overlaySeconds=Math.min(FIRST_SCENE_LEAD_SECONDS,
    Math.max(0,Number(clips[0].end)-previous));
  return {clips,introSeconds:0,overlaySeconds,prerollSeconds};
}
export function introOverlayOpacity(seconds,duration=FIRST_SCENE_LEAD_SECONDS){
  const t=Number(seconds),d=Number(duration);
  if(!Number.isFinite(t)||!Number.isFinite(d)||d<=0||t<0||t>=d)return 0;
  const fadeIn=Math.min(.3,d*.35);
  const fadeOut=Math.min(.5,d*.4);
  return Math.max(0,Math.min(1,t/fadeIn,(d-t)/fadeOut));
}
