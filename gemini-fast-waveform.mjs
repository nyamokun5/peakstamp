/**
 * Obtain 0.25 s RMS waveform bins from WAV chunks already decoded for Gemini.
 * This skips a second full decode of the original large MOV on a fresh run.
 * Cached sections are intentionally not regenerated: caller uses legacy decode
 * if any bins are missing. Gemini event data is never touched.
 */
import {MAX_GEMINI_DURATION_SECONDS} from './gemini-wav-chunks.mjs?v=long30';
export function createGeminiFastWaveform(duration,{binSeconds=.25}={}){
  const n=Math.ceil(Number(duration)/binSeconds);
  if(!Number.isFinite(Number(duration))||Number(duration)<=0||Number(duration)>MAX_GEMINI_DURATION_SECONDS||
     !(n>0&&n<=Math.ceil(MAX_GEMINI_DURATION_SECONDS/binSeconds))||
     !(binSeconds>0&&binSeconds<=1))throw Error('波形の長さが不正です。');
  const energy=new Float64Array(n),counts=new Uint32Array(n);
  return {
    async add(segment){
      const blob=segment?.blob;
      if(!(blob instanceof Blob))throw Error('WAV区間が見つかりません。');
      const buffer=await blob.arrayBuffer(),view=new DataView(buffer);
      if(view.byteLength<44||view.getUint32(24,true)!==16000||
         view.getUint16(22,true)!==1||view.getUint16(34,true)!==16)
        throw Error('波形の音声形式が不正です。');
      const frameCount=Math.min((view.byteLength-44)>>1,view.getUint32(40,true)>>1);
      const offset=Number(segment.startSeconds);
      for(let i=0;i<frameCount;i+=4){
        const bin=Math.floor((offset+i/16000)/binSeconds+1e-7);
        if(bin<0||bin>=n)continue;
        const sample=view.getInt16(44+i*2,true)/32768;
        energy[bin]+=sample*sample;
        counts[bin]++;
      }
    },
    finish(){
      if(counts.some(count=>count===0))return null;
      return {duration:Number(duration),bins:Array.from({length:n},(_,i)=>({
        time:i*binSeconds,rms:Math.sqrt(energy[i]/counts[i])
      }))};
    }
  };
}
