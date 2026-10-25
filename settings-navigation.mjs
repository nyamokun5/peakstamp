/**
 * Keep the MAIN PeakStamp document (and its browser-owned MOV File objects)
 * alive while the user visits secondary settings/reconciliation pages.
 * Never navigate/reload the top-level editor document for those tools.
 */
const PAGES=new Map([
 ['reset-goals.html','ゴールデータ管理'],
 ['sposched-review.html','Shoot Sunday 試合・選手照合']
]);
const HISTORY_FLAG='__peakstampSettingsOverlay';

export function initSettingsNavigation({
 document:doc=globalThis.document,
 window:win=globalThis.window,
 onOpen=()=>{},
 onClose=()=>{}
}={}){
 const backdrop=doc.getElementById('settingsOverlay');
 const frame=doc.getElementById('settingsOverlayFrame');
 const closeButton=doc.getElementById('settingsOverlayClose');
 const title=doc.getElementById('settingsOverlayTitle');
 if(!backdrop||!frame||!closeButton||!title)throw Error('設定画面のコンテナがありません');
 let openedName='',returnFocus=null;
 const cleanName=href=>{
  try{
   const url=new URL(href,win.location.href);
   if(url.origin!==win.location.origin)return '';
   const name=url.pathname.split('/').pop();
   return PAGES.has(name)?name:'';
  }catch{return ''}
 };
 const makeFrameUrl=(name,href)=>{
  const url=new URL(href||name,win.location.href);
  url.searchParams.set('returnTab','1');
  url.searchParams.set('embedded','1');
  return url.href;
 };
 const open=(name,href,{addHistory=false,trigger=null}={})=>{
  if(!PAGES.has(name))return false;
  if(openedName===name&&!backdrop.hidden)return true;
  if(!backdrop.hidden)hide();
  if(trigger)returnFocus=trigger;
  onOpen(name);
  openedName=name;
  title.textContent=PAGES.get(name);
  frame.title=PAGES.get(name);
  frame.src=makeFrameUrl(name,href);
  backdrop.hidden=false;
  closeButton.focus?.();
  if(addHistory&&win.history?.pushState){
   // Safari Back closes the settings layer, NOT the uploaded-video editor.
   const previous=win.history.state;
   const state=previous&&typeof previous==='object'?{...previous}:{};
   state[HISTORY_FLAG]={name,href:href||name};
   win.history.pushState(state,'',win.location.href);
  }
  return true;
 };
 const hide=()=>{
  if(backdrop.hidden)return false;
  const closed=openedName;
  backdrop.hidden=true;
  openedName='';
  frame.removeAttribute('src');
  onClose(closed);
  const target=returnFocus;
  returnFocus=null;
  target?.focus?.();
  return true;
 };
 const close=()=>{
  if(backdrop.hidden)return;
  // Close immediately; unwind exactly the synthetic history entry.
  const hasEntry=Boolean(win.history?.state?.[HISTORY_FLAG]);
  hide();
  if(hasEntry)win.history.back();
 };
 for(const link of doc.querySelectorAll('a[href]')){
  const href=link.getAttribute('href')||'';
  const name=cleanName(href);
  if(!name)continue;
  link.addEventListener('click',event=>{
   // Cmd/Ctrl/long-press remain ordinary browser actions.
   if(event.defaultPrevented||event.metaKey||event.ctrlKey||
      event.shiftKey||event.altKey||event.button>0)return;
   event.preventDefault();
   open(name,href,{addHistory:true,trigger:link});
  });
 }
 closeButton.addEventListener('click',close);
 backdrop.addEventListener('click',event=>{
  if(event.target===backdrop)close();
 });
 win.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!backdrop.hidden){event.preventDefault();close();}
 });
 win.addEventListener('popstate',event=>{
  const entry=event.state?.[HISTORY_FLAG];
  if(entry&&PAGES.has(entry.name)){
   if(backdrop.hidden)open(entry.name,entry.href,{addHistory:false});
  }else if(!backdrop.hidden)hide();
 });
 return {open,close,isOpen:()=>!backdrop.hidden,activePage:()=>openedName};
}
