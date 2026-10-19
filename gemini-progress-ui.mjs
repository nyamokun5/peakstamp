/**
 * Honest progress for Gemini: counts completed audio segments, not elapsed time.
 * 0-90%: all audio chunks; 90-99%: local waveform + results preparation;
 * 100% is shown only after the review candidates were committed.
 */
export function geminiProgressValue({done=0,total=0,phase='segments',waveform=0}={}){
 if(phase==='complete')return 100;
 if(phase==='preparing'||phase==='restoring')return 0;
 if(phase==='waveform'){
  const pct=Number.isFinite(Number(waveform))?Number(waveform):0;
  return Math.max(90,Math.min(99,Math.round(90+Math.max(0,Math.min(100,pct))*.09)));
 }
 if(phase==='finalizing')return 99;
 if(!(Number(total)>0))return 0;
 return Math.max(0,Math.min(90,Math.round(90*Math.max(0,Number(done)||0)/total)));
}
export function createGeminiProgressUI({
 root=document.getElementById('geminiProgress'),
 label=document.getElementById('geminiProgressLabel'),
 percent=document.getElementById('geminiProgressPercent'),
 bar=document.getElementById('geminiProgressBar'),
 detail=document.getElementById('geminiProgressDetail')
}={}){
 let current=0,active=false;
 const show=(message,value,description)=>{
  if(!root||!label||!percent||!bar||!detail)return;
  root.hidden=false;
  current=Math.max(current,Math.max(0,Math.min(100,Math.round(value))));
  label.textContent=message;
  percent.textContent=current+'%';
  bar.style.width=current+'%';
  root.setAttribute('aria-valuenow',String(current));
  root.setAttribute('aria-valuetext',message+' '+current+'%');
  detail.textContent=description;
 };
 return {
  start(message='解析の準備中…'){
   active=true;current=0;
   if(root){root.classList.remove('progress-error');root.classList.add('is-running');root.hidden=false;}
   show(message,0,'完了した音声区間を基準に表示');
  },
  segments(done,total,inFlight=0){
   if(!active)return;
   show('音声を解析中 · '+done+'/'+total+' 区間',
    geminiProgressValue({done,total}),
    inFlight>0?'Gemini処理中 '+inFlight+' 区間 · 完了済みは自動保存':'完了した区間は自動保存');
  },
  waveform(value=0){
   if(!active)return;
   show('シーンの確認画面を準備中',geminiProgressValue({phase:'waveform',waveform:value}),
     'Gemini解析は完了しています');
  },
  finalizing(){
   if(active)show('シーンをまとめています',99,'もう少しで確認できます');
  },
  complete(){
   if(!active)return;
   show('解析完了',100,'見どころ候補を確認できます');
   root?.classList.remove('is-running');
   active=false;
  },
  fail(message='解析が中断されました'){
   if(!active)return;
   root?.classList.add('progress-error');
   root?.classList.remove('is-running');
   show(message,current,'完了済み区間は保存されています');
   active=false;
  }
 };
}
