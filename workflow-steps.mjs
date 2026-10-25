/**
 * PeakStamp three-step workflow. Changes only visibility/navigation,
 * never recreates the parent document or media File/Blob references.
 */
const STAGES=['analysis','edit','export'];
const idToStage=['choosePanel','goalStatsPanel','montagePanel'];
export function initWorkflowSteps({document:doc=globalThis.document,onChange=()=>{},hasMedia=()=>false,hasReview=()=>false}={}){
 const body=doc.body, nav=doc.getElementById('journeyNav');
 const notice=doc.getElementById('workflowStageNotice');
 const buttons=[...nav.querySelectorAll('[data-journey-step]')];
 let current='analysis',seenReview=false;
 const visible=()=>({
  analysis:true,
  edit:hasMedia()&&hasReview(),
  export:hasMedia()&&hasReview()
 });
 const refresh=()=>{
  const allowed=visible();
  buttons.forEach((button,index)=>{
   const stage=STAGES[index],selected=stage===current;
   button.classList.toggle('current',selected);
   button.setAttribute('aria-current',selected?'step':'false');
   button.disabled=stage!=='analysis'&&!allowed[stage];
   button.setAttribute('aria-disabled',String(button.disabled));
  });
  if(notice){
   if(current==='analysis')notice.textContent='動画を選び、AIで見どころを検出します。';
   else if(current==='edit')notice.textContent='⚽ ゴールと通常ハイライトを確認し、切り取り・ズームを調整します。';
   else notice.textContent='キープしたシーンを結合してMP4に書き出します。';
  }
 };
 const setStage=(stage,{scroll=true}={})=>{
  if(!STAGES.includes(stage))return false;
  const allowed=visible();
  if(!allowed[stage])return false;
  if(stage!==current){
   const old=current;
   current=stage;
   body.dataset.psStage=stage;
   onChange(stage,old);
  }
  refresh();
  if(scroll){
   const target=doc.getElementById(idToStage[STAGES.indexOf(stage)]);
   if(target&&!target.hidden)target.scrollIntoView?.({behavior:'smooth',block:'start'});
   else nav.scrollIntoView?.({behavior:'smooth',block:'start'});
  }
  return true;
 };
 const autoAdvance=({busy=false}={})=>{
  const ready=visible().edit;
  if(ready&&!seenReview&&!busy&&current==='analysis'){
   seenReview=true;
   setStage('edit',{scroll:false});
  }else if(ready)seenReview=true;
  if(!ready)seenReview=false;
  refresh();
 };
 buttons.forEach((button,index)=>button.addEventListener('click',()=>setStage(STAGES[index])));
 doc.getElementById('workflowToExport')?.addEventListener('click',()=>setStage('export'));
 doc.getElementById('workflowBackToEdit')?.addEventListener('click',()=>setStage('edit'));
 body.dataset.psStage=current;
 refresh();
 return {setStage,refresh,autoAdvance,current:()=>current,available:visible};
}
