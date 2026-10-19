/** Preview-only sound control for the retained scene video player.
 * iOS Safari ignores HTMLMediaElement.volume: route its audio through a
 * GainNode when available. Never change exported MP4 audio.
 */
export const previewVolume = value =>
  Math.max(0,Math.min(100,Math.round(Number(value)||0)));

export function isIOSVolumeRestricted({
  userAgent='',platform='',maxTouchPoints=0
}={}) {
  return /iPhone|iPad|iPod/i.test(userAgent) ||
    (platform==='MacIntel' && Number(maxTouchPoints)>1);
}
export function createScenePreviewAudio({
  needsGain = isIOSVolumeRestricted(typeof navigator==='undefined'?{}:{
    userAgent:navigator.userAgent,platform:navigator.platform,
    maxTouchPoints:navigator.maxTouchPoints
  }),
  audioContextFactory=()=>{
    const Ctor=globalThis.AudioContext||globalThis.webkitAudioContext;
    return Ctor?new Ctor():null;
  }
}={}) {
  let level=100;
  let attached=null;
  let audio=null;
  let mode=needsGain?'hardware':'native';
  const apply=video=>{
    if(!video)return;
    const fraction=level/100;
    // The gain graph is the only attenuation when connected; do not square
    // the attenuation by setting the native element volume as well.
    if(audio?.video===video){
      audio.gain.gain.value=fraction;
      try{video.volume=1;}catch(_){}
    }else{
      try{video.volume=fraction;}catch(_){}
    }
    video.muted=level===0;
  };
  function attach(video){
    if(!video)throw Error('プレビュー動画がありません。');
    if(attached && attached!==video)dispose();
    attached=video;
    if(needsGain && !audio && mode!=='hardware-fallback'){
      let context=null;
      try{
        context=audioContextFactory();
        if(!context || typeof context.createMediaElementSource!=='function')
          throw Error('Web Audio unavailable');
        const mediaSource=context.createMediaElementSource(video);
        const gain=context.createGain();
        mediaSource.connect(gain);
        gain.connect(context.destination);
        audio={video,context,gain,mediaSource};
        mode='gain';
      }catch(_){
        // Native mute works even when intermediate iOS volume is restricted.
        mode='hardware-fallback';
        try{context?.close?.()?.catch?.(()=>{});}catch(_){}
      }
    }
    apply(video);
    return {mode,level,canAdjust:mode!=='hardware-fallback'};
  }
  function wake(){
    if(!audio)return Promise.resolve(true);
    try{
      if(audio.context.state==='running')return Promise.resolve(true);
      return Promise.resolve(audio.context.resume()).then(()=>true,()=>false);
    }catch(_){return Promise.resolve(false);}
  }
  function setLevel(value){
    level=previewVolume(value);
    apply(attached);
    return level;
  }
  function dispose(){
    const previous=audio;
    audio=null;attached=null;
    mode=needsGain?'hardware':'native';
    if(previous){
      try{Promise.resolve(previous.context.close()).catch(()=>{});}catch(_){}
    }
  }
  return {
    attach,wake,setLevel,dispose,
    get level(){return level;},
    get mode(){return mode;}
  };
}
