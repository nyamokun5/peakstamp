/** First-visit navigation. UI state only; never clears media or Gemini caches. */
const GUIDE_KEY='peakstamp_first_run_guide_v1';
const steps=[
  {title:'動画を選ぶ',body:'まず試合のMOV / MP4を選択。長い動画は1本ずつがおすすめ。',target:'uploadZone'},
  {title:'Geminiで見どころを探す',body:'アクセスコードを入力し、音声送信に同意して解析。完了区間がバーで分かります。',target:'geminiPrimaryPanel'},
  {title:'キープして動画にする',body:'「▶ リプレイ」で確認。指で拡大したり、開始・終了を調整し、良いシーンをキープ。',target:'resultsPanel'}
];
export function initFirstRunGuide({storage=window.localStorage,hasPriorAnalysis=()=>false}={}){
 const root=document.getElementById('firstRunOverlay');
 const reopen=document.getElementById('openGuide');
 const next=document.getElementById('guideNext');
 const skip=document.getElementById('guideSkip');
 const title=document.getElementById('guideTitle');
 const description=document.getElementById('guideDescription');
 const counter=document.getElementById('guideCounter');
 const nav=document.getElementById('journeyNav');
 if(!root||!reopen||!next||!skip||!nav)return {update:()=>{}};
 let index=0,lastFocus=null;
 const read=()=>{try{return storage.getItem(GUIDE_KEY)==='done';}catch{return false;}};
 const write=()=>{try{storage.setItem(GUIDE_KEY,'done');}catch{}};
 const paint=()=>{
  title.textContent=steps[index].title;
  description.textContent=steps[index].body;
  counter.textContent=(index+1)+' / '+steps.length;
  next.textContent=index===steps.length-1?'使い始める →':'次へ →';
  for(const [i,button] of [...root.querySelectorAll('[data-guide-step]')].entries()){
   button.classList.toggle('active',i===index);
   button.setAttribute('aria-current',i===index?'step':'false');
  }
 };
 const close=({navigate=false}={})=>{
  root.hidden=true;
  write();
  lastFocus?.focus?.();
  if(navigate){
   // At the end of the tour, begin the real flow from the first step.
   const target=document.getElementById(steps[0].target);
   if(target&&!target.hidden)target.scrollIntoView({behavior:'smooth',block:'start'});
  }
 };
 const open=()=>{
  lastFocus=document.activeElement;
  index=0;paint();root.hidden=false;next.focus();
 };
 reopen.addEventListener('click',open);
 next.addEventListener('click',()=>{
  if(index<steps.length-1){index++;paint();}
  else close({navigate:true});
 });
 skip.addEventListener('click',()=>close());
 root.querySelectorAll('[data-guide-step]').forEach(btn=>btn.addEventListener('click',()=>{
  index=Number(btn.dataset.guideStep)||0;paint();
 }));
 root.addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();close();return;}
  if(e.key!=='Tab')return;
  const focusable=[...root.querySelectorAll('button:not([disabled])')];
  const first=focusable[0],last=focusable.at(-1);
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
 });
 function update({hasVideo=false,hasResults=false}={}){
  const current=hasResults?2:hasVideo?1:0;
  nav.querySelectorAll('[data-journey-step]').forEach(btn=>{
   const at=Number(btn.dataset.journeyStep);
   btn.classList.toggle('current',at===current);
   btn.classList.toggle('finished',at<current);
   btn.setAttribute('aria-current',at===current?'step':'false');
  });
 }
 nav.querySelectorAll('[data-journey-step]').forEach(btn=>btn.addEventListener('click',()=>{
  const target=steps[Number(btn.dataset.journeyStep)]?.target;
  const element=document.getElementById(target);
  if(element&&!element.hidden)element.scrollIntoView({behavior:'smooth',block:'start'});
 }));
 // Existing users with saved Gemini results should not be interrupted by a
 // newly introduced tour; the guide stays accessible from the header.
 if(!read()&&!hasPriorAnalysis())open();
 return {update,open};
}
