/**
 * PeakStamp Video Explore beta: low-resolution camera motion compensation.
 * This is NOT ball, goal, player or actual shot recognition.
 * Input: low-resolution luminance frames sampled from a user's local video.
 * No network calls, model downloads or image upload.
 */
export const VIDEO_SCAN_ALGORITHM='camera-motion-v2-relative-residual';
const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(v)?v:min));
const abs=Math.abs;

function frameCheck(frame){
  if(!frame||!Number.isFinite(frame.time)||!Number.isInteger(frame.width)||
     !Number.isInteger(frame.height)||frame.width<32||frame.height<24||
     !(frame.luma instanceof Uint8Array)||
     frame.luma.length!==frame.width*frame.height)throw Error('映像フレーム形式が不正です');
}

function imageTexture(luma,width,height){
  let total=0,count=0;
  for(let y=3;y<height-3;y+=4){
    for(let x=3;x<width-3;x+=4){
      const p=y*width+x;
      const d=abs(luma[p]-luma[p+2])+abs(luma[p]-luma[p+width*2]);
      total+=d;
      count++;
    }
  }
  return total/Math.max(1,count);
}
function mismatch(previous,current,width,height,dx,dy,step=4){
  // Static pitch features (lines, goal posts, boundary boards) appear
  // translated between frames as the operator pans. Skip borders to avoid
  // evaluating out-of-frame regions.
  let weighted=0,weights=0;
  const marginX=24,marginY=9;
  for(let y=marginY;y<height-marginY;y+=step){
    const prevY=y+dy;
    if(prevY<2||prevY>=height-2)continue;
    for(let x=marginX;x<width-marginX;x+=step){
      const prevX=x+dx;
      if(prevX<2||prevX>=width-2)continue;
      const p=y*width+x,q=prevY*width+prevX;
      // Edges get a slightly higher weight, but uniform grass still counts
      // so a bright foreground object cannot set the whole pan estimate.
      const edge=abs(previous[q+1]-previous[q-1])+
                 abs(previous[q+width]-previous[q-width]);
      const weight=1+Math.min(2,edge/28);
      weighted+=abs(current[p]-previous[q])*weight;
      weights+=weight;
    }
  }
  return weights?weighted/weights:255;
}
export function compareVideoFrames(before,after){
  frameCheck(before);frameCheck(after);
  if(before.width!==after.width||before.height!==after.height)throw Error('映像のサイズが一致していません');
  const {width,height}=before;
  const elapsed=Math.max(.1,after.time-before.time);
  const texture=imageTexture(before.luma,width,height);
  const zero=mismatch(before.luma,after.luma,width,height,0,0);
  const xBound=Math.min(22,Math.floor(width*.23));
  const yBound=Math.min(6,Math.floor(height*.14));
  let best={dx:0,dy:0,error:zero};
  // Full-pixel search is deliberate: coarse 2px shifts can fail badly when
  // an odd-pixel displacement (e.g. 9px) is a sharp correlation minimum.
  // Frames are <=96px wide, so this remains inexpensive without OpenCV.
  for(let dy=-yBound;dy<=yBound;dy++){
    for(let dx=-xBound;dx<=xBound;dx++){
      const error=mismatch(before.luma,after.luma,width,height,dx,dy);
      if(error<best.error){best={dx,dy,error};}
    }
  }
  const compensated=best.error;
  const improvement=clamp((zero-compensated)/Math.max(5,zero));
  const textureConfidence=clamp((texture-2)/14);
  // If best match touches the shift-search limits it may be an inaccurate
  // estimate of a larger hand-held pan. Never treat that as a confident turn.
  const alignmentLimited=abs(best.dx)>=xBound-1||abs(best.dy)>=yBound-1;
  const panConfident=!alignmentLimited&&textureConfidence>.25&&improvement>.07;
  // Preserve unsaturated luminance error. An adaptive relative transform is
  // applied AFTER comparing all video frames; fixed /38 saturated real MOVs.
  const residual=Math.max(0,compensated);
  return {
    time:after.time,elapsed,
    cameraDx:best.dx,cameraDy:best.dy,
    panPixels:Math.hypot(best.dx,best.dy),
    panSpeed:Math.hypot(best.dx,best.dy)/elapsed,
    compensatedDifference:+compensated.toFixed(3),
    uncorrectedDifference:+zero.toFixed(3),
    residual:+residual.toFixed(4),
    texture:+texture.toFixed(3),
    improvement:+improvement.toFixed(4),
    cameraConfidence:+(panConfident?textureConfidence*improvement:0).toFixed(4),
    alignmentLimited,
    cameraSearchX:xBound,cameraSearchY:yBound,
    confidence:alignmentLimited?'移動補正の範囲外の可能性':panConfident?'推定可':'低い',
    sceneScore:0
  };
}

function findPeaks(signal,minimumSpacing,maxResults){
  return signal.filter(x=>x.score>=.16)
    .sort((a,b)=>b.score-a.score||a.peakSeconds-b.peakSeconds)
    .reduce((selected,item)=>{
      if(selected.length<maxResults&&selected.every(x=>abs(x.peakSeconds-item.peakSeconds)>=minimumSpacing)){
        selected.push(item);
      }
      return selected;
    },[]).sort((a,b)=>a.peakSeconds-b.peakSeconds);
}

/**
 * More inclusive first-stage video candidates:
 * - movement after compensating for horizontal/vertical camera follow
 * - camera braking/turning
 * - repeated strong scene changes within a short attack sequence
 * This does not decide whether a shot or goalkeeper is actually visible.
 */
export function discoverVideoMotionCandidates(frames,options={}){
  const maxResults=Math.max(1,Math.min(30,Math.floor(Number(options.maxResults)||12)));
  const spacing=Math.max(4,Math.min(20,Number(options.minGapSeconds)||10));
  const features=[];
  if(!Array.isArray(frames)||frames.length<3)return {candidates:[],measurements:[],summary:{frames:frames?.length||0}};
  const ordered=[...frames].sort((a,b)=>a.time-b.time);
  for(let i=1;i<ordered.length;i++){
    const now=compareVideoFrames(ordered[i-1],ordered[i]);
    const prior=features[features.length-1];
    const currentPan=now.cameraConfidence>0?now.cameraDx:0;
    const prevPan=prior?.cameraConfidence>0?prior.cameraDx:0;
    // Braking or reversing the pan often happens when play reaches a target,
    // but also when the operator simply adjusts framing.
    const brake=prior?.cameraConfidence>0?
      clamp((abs(prevPan)-abs(currentPan))/Math.max(6,now.elapsed*8)):0;
    const reverse=prior?.cameraConfidence>0&&currentPan*prevPan<0?
      clamp(Math.min(abs(currentPan),abs(prevPan))/10):0;
    const panTurn=clamp(brake*.7+reverse*.5);
    // Score calculation deliberately happens after the full-video
    // normalization. Do not clip raw residuals at this stage.
    features.push({...now,panTurn:+panTurn.toFixed(4)});
  }
  // Per-video normalization is essential. The previous fixed /38 clip
  // collapsed eleven of twelve real-world feedback examples to exactly 1.
  // This does NOT make it a semantic shot detector; it only restores contrast.
  const errors=features.map(x=>x.compensatedDifference).sort((a,b)=>a-b);
  const quantile=p=>errors[Math.min(errors.length-1,Math.floor((errors.length-1)*p))]||0;
  const q25=quantile(.25),q90=quantile(.90);
  const relativeScale=Math.max(8,q90-q25);
  const normalizeResidual=x=>clamp((x.compensatedDifference-q25)/relativeScale);
  const timeline=features.map((f,i)=>{
    const next=features[Math.min(features.length-1,i+1)];
    const prev=features[Math.max(0,i-1)];
    // Camera operator reaction may come a frame after the kick.
    const reliability=f.alignmentLimited?0:clamp(f.cameraConfidence);
    const normalized=normalizeResidual(f);
    // When camera alignment is uncertain, keep some visual evidence for
    // recall, but lower its contribution rather than falsely claiming a
    // reliably camera-corrected moving object.
    const foreground=normalized*(.72+.28*reliability);
    const nextNormalized=normalizeResidual(next);
    const previousNormalized=normalizeResidual(prev);
    const change=clamp((normalized-previousNormalized)/.4);
    const panTurn=f.panTurn*(f.alignmentLimited?.15:1);
    const motion=clamp(f.panSpeed/13)*reliability;
    const visualScore=clamp(.67*foreground+.16*panTurn+.08*motion+.09*change);
    const adjacent=Math.max(nextNormalized,previousNormalized);
    const temporal=Math.max(visualScore,.85*visualScore+.15*adjacent*.67);
    const score=clamp(temporal);
    return {
      id:'video-motion-'+Math.round(f.time*1000),
      peakSeconds:f.time,
      time:Math.max(0,Math.floor(f.time-7)),
      score:+score.toFixed(4),
      visualScore:+visualScore.toFixed(4),
      detail:{
        residual:+normalized.toFixed(4),
        rawResidual:f.residual,
        relativeResidual:+normalized.toFixed(4),
        alignmentLimited:f.alignmentLimited,
        cameraSearchX:f.cameraSearchX,
        cameraSearchY:f.cameraSearchY,
        cameraDx:f.cameraDx,cameraDy:f.cameraDy,
        panSpeed:+f.panSpeed.toFixed(3),
        panTurn:f.panTurn,
        cameraConfidence:f.cameraConfidence,
        confidence:f.confidence,
        texture:f.texture,
        rawDifference:f.uncorrectedDifference,
        compensatedDifference:f.compensatedDifference,
        frameInterval:f.elapsed
      },
      evidence:'カメラ移動補正後の映像変化（シュート未確定）',
      discovery:'video-motion'
    };
  });
  const chosen=findPeaks(timeline,spacing,maxResults);
  return {
    candidates:chosen,
    measurements:features.map((x,i)=>({
      time:x.time,dx:x.cameraDx,dy:x.cameraDy,
      rawResidual:x.residual,
      relativeResidual:+normalizeResidual(x).toFixed(4),
      panTurn:x.panTurn,visualScore:timeline[i].visualScore,
      candidateScore:timeline[i].score,
      confidence:x.cameraConfidence,
      alignmentLimited:x.alignmentLimited
    })),
    summary:{
      frames:ordered.length,compared:features.length,possible:timeline.filter(x=>x.score>=.16).length,
      selected:chosen.length,
      confidentPans:features.filter(f=>f.cameraConfidence>0).length,
      avgResidual:+(features.reduce((s,x)=>s+x.residual,0)/features.length).toFixed(4),
      residualQ25:+q25.toFixed(3),
      residualQ90:+q90.toFixed(3),
      residualScale:+relativeScale.toFixed(3),
      alignmentLimitedPairs:features.filter(x=>x.alignmentLimited).length,
      lowConfidencePairs:features.filter(x=>x.cameraConfidence<.15).length
    }
  };
}
