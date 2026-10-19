import { normalizeSceneZoom, normalizeSceneFocus, zoomDrawRect } from './editing-rules.mjs?v=pinch18';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const point=(event,rect)=>({x:event.clientX-rect.left,y:event.clientY-rect.top});

/** Center/clip the crop and derive its actual focal point after bounds clamping. */
function resolvedCrop(state,sourceWidth,sourceHeight,width,height){
  const z=normalizeSceneZoom(state?.zoom);
  const rect=zoomDrawRect(sourceWidth,sourceHeight,width,height,z,state?.zoomX,state?.zoomY);
  return {zoom:z,zoomX:normalizeSceneFocus((width/2-rect.dx)/rect.dw),
    zoomY:normalizeSceneFocus((height/2-rect.dy)/rect.dh)};
}
/** Pinch around the fingertips: the original source pixel at the first midpoint
 * stays beneath the new midpoint as fingers move, subject to edge clamping. */
export function pinchSceneCrop(sourceWidth,sourceHeight,width,height,initial,startA,startB,nowA,nowB){
  const old=zoomDrawRect(sourceWidth,sourceHeight,width,height,initial.zoom,initial.zoomX,initial.zoomY);
  const start=midpoint(startA,startB),now=midpoint(nowA,nowB);
  const zoom=normalizeSceneZoom((Number(initial.zoom)||1)*
    distance(nowA,nowB)/Math.max(1,distance(startA,startB)));
  const base=Math.min(width/sourceWidth,height/sourceHeight);
  const fullW=sourceWidth*base*zoom,fullH=sourceHeight*base*zoom;
  const sourcePointX=(start.x-old.dx)/old.dw;
  const sourcePointY=(start.y-old.dy)/old.dh;
  return resolvedCrop({
    zoom,
    zoomX:sourcePointX+(width/2-now.x)/fullW,
    zoomY:sourcePointY+(height/2-now.y)/fullH
  },sourceWidth,sourceHeight,width,height);
}
/** When zoomed, dragging one finger moves the selected subject on-screen. */
export function panSceneCrop(sourceWidth,sourceHeight,width,height,initial,from,to){
  const z=normalizeSceneZoom(initial.zoom);
  const base=Math.min(width/sourceWidth,height/sourceHeight);
  return resolvedCrop({
    zoom:z,
    zoomX:normalizeSceneFocus(initial.zoomX)-(to.x-from.x)/(sourceWidth*base*z),
    zoomY:normalizeSceneFocus(initial.zoomY)-(to.y-from.y)/(sourceHeight*base*z)
  },sourceWidth,sourceHeight,width,height);
}
/** One preview per kept clip. The same zoomDrawRect drives CSS and MP4 output. */
export function attachScenePinchEditor({viewport,video,read,write,commit,resetButton,readout}){
  const pointers=new Map();
  let gesture=null,changed=false,closed=false;
  let sourceWidth=16,sourceHeight=9;
  const dimensions=()=>{
    const rect=viewport.getBoundingClientRect();
    return {width:Math.max(1,rect.width),height:Math.max(1,rect.height)};
  };
  const render=()=>{
    if(closed)return;
    const {width,height}=dimensions();
    const state=read(),z=normalizeSceneZoom(state.zoom);
    const crop=zoomDrawRect(sourceWidth,sourceHeight,width,height,z,state.zoomX,state.zoomY);
    // transform-origin center: translate after scale, with exact exporter offset
    const tx=crop.dx-(width-crop.dw)/2,ty=crop.dy-(height-crop.dh)/2;
    video.style.transformOrigin='center center';
    video.style.transform='translate('+tx+'px, '+ty+'px) scale('+z+')';
    readout.textContent=z.toFixed(2).replace(/0$/,'').replace(/\.$/,'')+'倍';
    resetButton.disabled=z===1;
  };
  const resizeVideo=()=>{
    if(video.videoWidth>0&&video.videoHeight>0){
      sourceWidth=video.videoWidth;sourceHeight=video.videoHeight;
      viewport.style.aspectRatio=sourceWidth+' / '+sourceHeight;
      viewport.style.width='min(100%, '+(390*sourceWidth/sourceHeight)+'px)';
      render();
    }
  };
  const apply=(crop)=>{
    const prev=read();
    if(prev.zoom===crop.zoom&&normalizeSceneFocus(prev.zoomX)===crop.zoomX&&
       normalizeSceneFocus(prev.zoomY)===crop.zoomY)return;
    write(crop);changed=true;render();
  };
  const finalize=()=>{
    if(changed){commit();changed=false;}
  };
  const reset=()=>{
    pointers.clear();gesture=null;
    apply({zoom:1,zoomX:.5,zoomY:.5});finalize();
  };
  const begin=()=>{
    const points=[...pointers.values()];
    const {width,height}=dimensions();
    if(points.length>=2){
      gesture={type:'pinch',initial:{...read()},a:{...points[0]},b:{...points[1]},
        width,height};
    }else if(points.length===1){
      gesture={type:'pan',initial:{...read()},a:{...points[0]},width,height};
    }else gesture=null;
  };
  const down=(event)=>{
    if(event.pointerType==='mouse'&&event.button!==0)return;
    if(closed)return;
    const rect=viewport.getBoundingClientRect();
    pointers.set(event.pointerId,point(event,rect));
    try{viewport.setPointerCapture?.(event.pointerId);}catch{}
    begin();
    if(pointers.size>=2 || normalizeSceneZoom(read().zoom)>1)event.preventDefault();
  };
  const move=(event)=>{
    if(!pointers.has(event.pointerId)||!gesture)return;
    pointers.set(event.pointerId,point(event,viewport.getBoundingClientRect()));
    const pts=[...pointers.values()];
    if(pts.length>=2&&gesture.type==='pinch'){
      event.preventDefault();
      apply(pinchSceneCrop(sourceWidth,sourceHeight,gesture.width,gesture.height,
        gesture.initial,gesture.a,gesture.b,pts[0],pts[1]));
    }else if(pts.length===1&&gesture.type==='pan'&&normalizeSceneZoom(read().zoom)>1){
      event.preventDefault();
      apply(panSceneCrop(sourceWidth,sourceHeight,gesture.width,gesture.height,
        gesture.initial,gesture.a,pts[0]));
    }
  };
  const up=(event)=>{
    if(!pointers.has(event.pointerId))return;
    pointers.delete(event.pointerId);
    try{viewport.releasePointerCapture?.(event.pointerId);}catch{}
    if(pointers.size)begin();
    else{gesture=null;finalize();}
  };
  const wheel=(event)=>{
    // Desktop trackpads send ctrl+wheel for pinch; leave normal scrolling intact.
    if(!event.ctrlKey)return;
    event.preventDefault();
    const rect=viewport.getBoundingClientRect();
    const state=read();
    const p=point(event,rect);
    const center={x:p.x,y:p.y};
    const span=100;
    const scale=Math.exp(-event.deltaY*.008);
    const startA={x:center.x-span/2,y:center.y},startB={x:center.x+span/2,y:center.y};
    const nowA={x:center.x-span*scale/2,y:center.y},nowB={x:center.x+span*scale/2,y:center.y};
    apply(pinchSceneCrop(sourceWidth,sourceHeight,rect.width,rect.height,
      state,startA,startB,nowA,nowB));
    finalize();
  };
  const keyboard=(event)=>{
    if(!['+','=','-','0'].includes(event.key))return;
    event.preventDefault();
    if(event.key==='0'){reset();return;}
    const {width,height}=dimensions(),state=read(),span=100;
    const scale=event.key==='-'?.9:1.1;
    apply(pinchSceneCrop(sourceWidth,sourceHeight,width,height,
      state,{x:width/2-span/2,y:height/2},{x:width/2+span/2,y:height/2},
      {x:width/2-span*scale/2,y:height/2},{x:width/2+span*scale/2,y:height/2}));
    finalize();
  };
  viewport.addEventListener('pointerdown',down);
  viewport.addEventListener('pointermove',move);
  viewport.addEventListener('pointerup',up);
  viewport.addEventListener('pointercancel',up);
  viewport.addEventListener('lostpointercapture',up);
  viewport.addEventListener('wheel',wheel,{passive:false});
  viewport.addEventListener('keydown',keyboard);
  resetButton.addEventListener('click',reset);
  video.addEventListener('loadedmetadata',resizeVideo);
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(render):null;
  observer?.observe(viewport);
  window.addEventListener('resize',render);
  resizeVideo();render();
  const destroy=()=>{
    finalize();closed=true;
    observer?.disconnect();
    window.removeEventListener('resize',render);
    for(const [ev,fn] of [['pointerdown',down],['pointermove',move],['pointerup',up],
      ['pointercancel',up],['lostpointercapture',up],['wheel',wheel],['keydown',keyboard]])
      viewport.removeEventListener(ev,fn);
    resetButton.removeEventListener('click',reset);
    video.removeEventListener('loadedmetadata',resizeVideo);
  };
  // The + / - buttons use exactly the same zoom state and export framing
  // as finger pinch. Avoid a second, incompatible zoom implementation.
  destroy.zoomBy=(factor)=>{
    if(closed)return;
    const state=read();
    const zoom=normalizeSceneZoom((Number(state.zoom)||1)*factor);
    apply({...state,zoom});finalize();
  };
  destroy.reset=()=>{if(!closed)reset();};
  return destroy;
}
