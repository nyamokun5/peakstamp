/** Reuses regular scene gesture, single timeline and seek semantics for goal review.
 * One persistent video element/decoder is shared by every goal in the queue.
 */
import {clipMarkerPositions,timelineTimeAt,formatTimelineTime} from './editing-rules.mjs?v=peak52';
import {attachScenePinchEditor} from './scene-gesture.mjs?v=compact49';
import {actualGoalTime} from './goal-stats.mjs?v=unifiedga1';
import {goalSceneBounds,goalSceneZoom,setGoalSceneEdge,goalSceneReferenceTime} from './goal-scene-edit.mjs?v=unifiedga1';
const make=(tag,cls,text)=>{
 const el=document.createElement(tag);if(cls)el.className=cls;
 if(text!==undefined)el.textContent=text;return el;
};
const parseClock=value=>{
 const s=String(value||'').trim(),part=s.split(':');
 if(!s||part.length>3||part.some(x=>!/^\d+(?:\.\d+)?$/.test(x)))return null;
 let time=0;
 for(const p of part)time=time*60+Number(p);
 return Number.isFinite(time)?time:null;
};
export function createGoalSceneControls({viewer,video,label,status,
 onChange=()=>{},onReplay=()=>{},onSeek=()=>{},onPause=()=>{}}){
 let source=null,item=null,teardownZoom=null,drag=null;
 const viewport=make('div','goal-scene-viewport zoom-video-viewport');
 viewport.setAttribute('aria-label','2本指で画角の拡大・縮小、拡大後は1本指で移動');
 viewport.setAttribute('role','group');viewport.tabIndex=0;
 video.controls=false;video.className='inline-player';
 video.playsInline=true;video.setAttribute('playsinline','');video.setAttribute('webkit-playsinline','');
 viewport.append(video);
 const tip=make('span','pinch-overlay-tip','🤏 2本指で画角調整');
 tip.setAttribute('aria-hidden','true');viewport.append(tip);
 const zoomRow=make('div','scene-pinch-toolbar');
 zoomRow.append(make('span','scene-pinch-hint','🤏 2本指で画角調整 · 拡大後は1本指で移動'));
 const zoomValue=make('output','scene-pinch-value','1倍');zoomRow.append(zoomValue);
 const playRow=make('div','scene-playback-controls goal-scene-playback');
 const replay=make('button','play-btn goal-scene-replay','▶ リプレイ');
 replay.type='button';
 const pause=make('button','scene-pause-button','▶ 再生');pause.type='button';
 const mute=make('button','scene-mute-button','🔊');mute.type='button';
 replay.addEventListener('click',()=>onReplay());
 pause.addEventListener('click',()=>{
  if(video.paused)onSeek(Number.isFinite(video.currentTime)?video.currentTime:bounds().start);
  else onPause();
 });
 mute.addEventListener('click',()=>{
  video.muted=!video.muted;mute.textContent=video.muted?'🔇':'🔊';
 });
 playRow.append(replay,pause,mute);
 const range=make('div','range-editor goal-scene-range');
 const heading=make('div','range-heading');
 heading.append(make('strong','range-title','切り取り範囲'));
 const current=make('span','range-current','再生位置 —');heading.append(current);
 const legend=make('div','range-legend');
 const startLabel=make('span','range-start-label');
 const peakLabel=make('span','range-peak-label');
 const endLabel=make('span','range-end-label');
 legend.append(startLabel,peakLabel,endLabel);
 const track=make('div','range-track interactive-range');
 track.setAttribute('aria-label','緑と紫で開始・終了を調整、白で再生位置を調整');
 const fill=make('div','range-fill');
 const start=make('button','range-dot range-start range-handle');
 const peak=make('span','range-dot range-peak');
 const end=make('button','range-dot range-end range-handle');
 const head=make('button','range-playhead');head.type='button';
 for(const [button,title] of [[start,'切り取り開始時刻'],[end,'切り取り終了時刻'],[head,'白いハンドル：再生位置']]){
  button.type='button';button.setAttribute('role','slider');
  button.setAttribute('aria-label',title);
  button.setAttribute('aria-orientation','horizontal');
 }
 track.append(fill,start,peak,end,head);
 const hint=make('p','range-hint','緑・紫＝切り抜き ／ 白＝再生位置');
 const inputs=make('div','range-inputs');
 const field=(caption)=>{
  const wrap=make('label','range-field');
  wrap.append(make('span','',caption));
  const input=make('input','range-time');input.type='text';input.inputMode='text';
  wrap.append(input);inputs.append(wrap);return input;
 };
 const inputStart=field('開始');const inputEnd=field('終了');
 range.append(heading,legend,track,hint,inputs);
 viewer.replaceChildren(label,viewport,zoomRow,playRow,range,status);
 const duration=()=>{
  const sourceLength=Number(source?.duration);
  if(sourceLength>0)return sourceLength;
  const mediaLength=Number(video.duration);
  return mediaLength>0?mediaLength:Math.max(1,actualGoalTime(item)+2);
 };
 const bounds=()=>goalSceneBounds(item,duration());
 const timeWindow=()=> {
  const b=bounds();
  return drag?.window||clipMarkerPositions(b.start,goalSceneReferenceTime(item),b.end,duration());
 };
 const positionAt=x=>{
  const win=timeWindow();
  return timelineTimeAt(x,track.getBoundingClientRect(),win.left,win.right,.1);
 };
 const redraw=()=>{
  if(!item||!source)return;
  const b=bounds(),win=timeWindow();
  const pc=x=>Math.max(0,Math.min(100,(x-win.left)/Math.max(.001,win.right-win.left)*100));
  start.style.left=pc(b.start)+'%';
  end.style.left=pc(b.end)+'%';
  peak.style.left=pc(goalSceneReferenceTime(item))+'%';
  fill.style.left=pc(b.start)+'%';
  fill.style.width=Math.max(0,pc(b.end)-pc(b.start))+'%';
  startLabel.textContent='開始 '+formatTimelineTime(b.start);
  peakLabel.textContent=(item.origin==='audio'?'実況 ':'ゴール ')+formatTimelineTime(goalSceneReferenceTime(item));
  endLabel.textContent='終了 '+formatTimelineTime(b.end);
  if(drag?.kind!=='start')inputStart.value=formatTimelineTime(b.start);
  if(drag?.kind!=='end')inputEnd.value=formatTimelineTime(b.end);
  const at=drag?.kind==='seek'?drag.time:video.currentTime;
  const showTime=Number.isFinite(at)?Math.max(b.start,Math.min(b.end,at)):b.start;
  head.style.left=pc(showTime)+'%';head.hidden=video.readyState<1;
  current.textContent='再生位置 '+formatTimelineTime(showTime);
  pause.textContent=video.paused?'▶ 再生':'⏸ 一時停止';
  for(const [el,val,low,high] of [
   [start,b.start,0,b.end-.3],[end,b.end,b.start+.3,duration()],
   [head,showTime,b.start,b.end]
  ]){
   el.setAttribute('aria-valuemin',String(low));
   el.setAttribute('aria-valuemax',String(high));
   el.setAttribute('aria-valuenow',String(val));
  }
 };
 const saveEdge=(edge,time)=>{
  if(!item||!setGoalSceneEdge(item,edge,time,duration())){
   redraw();return false;
  }
  onChange(source,item);
  redraw();return true;
 };
 const onInput=(edge,input)=>input.addEventListener('change',()=>{
  const time=parseClock(input.value);
  if(time===null||!saveEdge(edge,time)){redraw();}
 });
 onInput('start',inputStart);onInput('end',inputEnd);
 const handle=(el,kind)=>{
  el.addEventListener('pointerdown',event=>{
   if(!item||event.button!==undefined&&event.button!==0)return;
   event.stopPropagation();event.preventDefault();
   drag={kind,id:event.pointerId,time:null,
    window:clipMarkerPositions(bounds().start,goalSceneReferenceTime(item),bounds().end,duration())};
   try{el.setPointerCapture?.(event.pointerId)}catch{}
  });
  el.addEventListener('pointermove',event=>{
   if(!drag||drag.id!==event.pointerId||drag.kind!==kind)return;
   event.preventDefault();
   drag.time=positionAt(event.clientX);
   const now=drag.time;
   if(kind==='start')start.style.left=pcDuring(now)+'%';
   else end.style.left=pcDuring(now)+'%';
  });
  const finish=event=>{
   if(!drag||drag.id!==event.pointerId||drag.kind!==kind)return;
   const at=drag.time??positionAt(event.clientX);
   drag=null;try{el.releasePointerCapture?.(event.pointerId)}catch{}
   saveEdge(kind,at);
  };
  el.addEventListener('pointerup',finish);
  el.addEventListener('pointercancel',()=>{drag=null;redraw()});
 };
 const pcDuring=at=>{
  const w=timeWindow();
  return Math.max(0,Math.min(100,(at-w.left)/Math.max(.001,w.right-w.left)*100));
 };
 handle(start,'start');handle(end,'end');
 track.addEventListener('pointerdown',event=>{
  if(!item||video.readyState<1||drag||event.target===start||event.target===end||
     (event.button!==undefined&&event.button!==0))return;
  event.preventDefault();onPause();
  const b=bounds();
  drag={kind:'seek',id:event.pointerId,
   time:Math.max(b.start,Math.min(b.end,positionAt(event.clientX))),
   window:clipMarkerPositions(b.start,goalSceneReferenceTime(item),b.end,duration())};
  try{track.setPointerCapture?.(event.pointerId)}catch{}
  hint.textContent='指を離すとその位置から再生';
  redraw();
 });
 track.addEventListener('pointermove',event=>{
  if(!drag||drag.kind!=='seek'||drag.id!==event.pointerId)return;
  const b=bounds();event.preventDefault();
  drag.time=Math.max(b.start,Math.min(b.end,positionAt(event.clientX)));
  redraw();
 });
 const finishSeek=(event,cancelled=false)=>{
  if(!drag||drag.kind!=='seek'||drag.id!==event.pointerId)return;
  const at=drag.time;drag=null;
  try{track.releasePointerCapture?.(event.pointerId)}catch{}
  hint.textContent='緑・紫＝切り抜き ／ 白＝再生位置';
  if(!cancelled)onSeek(at);
  redraw();
 };
 track.addEventListener('pointerup',event=>finishSeek(event));
 track.addEventListener('pointercancel',event=>finishSeek(event,true));
 head.addEventListener('keydown',event=>{
  if(!item||!['ArrowLeft','ArrowRight'].includes(event.key))return;
  event.preventDefault();
  const b=bounds(),target=Number(video.currentTime)+(event.key==='ArrowRight'?.5:-.5);
  onSeek(Math.max(b.start,Math.min(b.end,target)));
 });
 const onTime=()=>{
  if(!item||!source)return;
  const b=bounds();
  if(!video.seeking&&!video.paused&&video.currentTime>=b.end-.06)onPause();
  redraw();
 };
 for(const name of ['timeupdate','seeked','loadedmetadata','play','pause'])
  video.addEventListener(name,onTime);
 const activate=(nextSource,nextItem)=>{
  if(!nextSource||!nextItem)return;
  if(source===nextSource&&item===nextItem){redraw();return;}
  teardownZoom?.();teardownZoom=null;
  source=nextSource;item=nextItem;
  teardownZoom=attachScenePinchEditor({
   viewport,video,read:()=>goalSceneZoom(item),
   write:next=>{
    item.clipZoom=next.zoom;item.clipZoomX=next.zoomX;item.clipZoomY=next.zoomY;
    if(next.zoom>1.02)tip.hidden=true;
   },
   commit:()=>onChange(source,item),readout:zoomValue
  });
  tip.hidden=goalSceneZoom(item).zoom>1.02;
  redraw();
 };
 return {activate,redraw,clipBounds:bounds,playButton:replay,
  destroy:()=>{teardownZoom?.();teardownZoom=null}};
}
