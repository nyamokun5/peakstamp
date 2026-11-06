/**
 * Guided PeakStamp journey: short, actionable completion dialogs.
 * Neither this module nor any dialog action reloads the editor/MOV files.
 */
export function analysisCounts(sources=[],goalRows=[]){
 const goals=(goalRows||[]).filter(x=>x?.item?.status!=='excluded').length;
 const highlights=(sources||[]).reduce((n,s)=>
  n+(s.candidates||[]).filter(c=>!c.goalRecordId&&!c.goalVideoOwned).length,0);
 return {goals,highlights};
}
export function initJourneyCoach({
 document:doc=globalThis.document,
 actions={},counts=()=>({goals:0,highlights:0})
}={}){
 const $=id=>doc.getElementById(id);
 const root=$('journeyDialog'),headline=$('journeyDialogTitle'),
  message=$('journeyDialogBody'),primary=$('journeyDialogPrimary'),
  secondary=$('journeyDialogSecondary'),dismiss=$('journeyDialogDismiss');
 if(!root||!headline||!message||!primary||!secondary||!dismiss)
  throw Error('Journey dialog elements missing');
 let pending=null,goalIntroSeen=false,lastFocus=null;
 function close(){
  root.hidden=true;
  pending=null;
  lastFocus?.focus?.();
  lastFocus=null;
 }
 function show({title,body,main,other=null}){
  if(!root.hidden)close();
  lastFocus=doc.activeElement;
  headline.textContent=title;
  message.textContent=body;
  const wire=(button,action)=>{
   button.hidden=!action;
   if(action){
    button.textContent=action.label;
    button.onclick=()=>{
     // Close BEFORE executing navigation; keep Safari File objects intact.
     close();
     action.run?.();
    };
   }else button.onclick=null;
  };
  wire(primary,main);wire(secondary,other);
  const register=$('journeyDialogRegister');
  if(register)register.hidden=title!=='ゴール確認完了';
  root.hidden=false;
  primary.focus?.();
  pending={title,body};
 }
 dismiss.addEventListener('click',close);
 root.addEventListener('click',event=>{if(event.target===root)close();});
 doc.addEventListener?.('keydown',event=>{
  if(event.key==='Escape'&&!root.hidden){event.preventDefault?.();close();}
 });
 const reviewGoals=()=>{actions.goGoals?.();showGoalIntro();};
 const goHighlights=()=>actions.goHighlights?.();
 function showGoalIntro(){return false;}
 function analysisFinished({success=true,error='',failures=0}={}){
  const {goals,highlights}=counts();
  if(!success){
   show({
    title:'解析できませんでした',
    body:'解析を完了できませんでした。'+(error?'\n原因：'+String(error).slice(0,260):'')+
      '\n動画を読み込めるか・ネット接続・アクセスコードを確認して再解析してください。途中まで成功した区間は再利用できる場合があります。',
    main:{label:'解析画面に戻る',run:()=>actions.goAnalysis?.()}
   });
   return;
  }
  show({
   title:failures?'解析完了（一部失敗）':'解析完了',
   body:failures?'解析できない動画があります。動画を選び直してください。':'',
   main:{label:goals?'ゴールを確認':'ハイライトを確認',
    run:goals?reviewGoals:goHighlights},
   other:failures?{label:'失敗した動画を確認',run:()=>actions.goAnalysis?.()}:null
  });
 }
 function goalReviewFinished({total=0,unconfirmed=0}={}){
  show({
   title:'ゴール確認完了',
   body:unconfirmed?'得点情報の未確定が'+unconfirmed+'件あります。':'',
   main:{label:'ハイライトを確認',run:goHighlights},
   other:{label:'ゴールを再確認',run:()=>{actions.goGoals?.();actions.showGoalList?.();}}
  });
 }
 function highlightReviewFinished({total=0,kept=0}={}){
  show({
   title:'ハイライト確認完了',
   body:kept?'':'動画を1件以上採用してください。',
   main:kept
    ?{label:'動画の書き出しへ',run:()=>actions.goExport?.()}
    :{label:'シーンをもう一度見る',run:()=>actions.reviewAllHighlights?.()},
   other:kept?{label:'シーンをもう一度見る',run:()=>actions.reviewAllHighlights?.()}:null
  });
 }
 function exportFinished(){
  show({
   title:'MP4の書き出しが完了しました！',
   body:'iPhoneに保存・HS向けJSONを共有',
   main:{label:'▶ 完成動画を確認',run:()=>actions.showExportPreview?.()},
   other:{label:'HS向けJSONを保存',run:()=>actions.saveHSJson?.()}
  });
 }
 function exportFailed(error){
  show({
   title:'動画を書き出せませんでした',
   body:String(error||'書き出しに失敗しました。').slice(0,300)+
    '\n画質を下げる、シーンを減らす、空き容量を確認するなどして再実行してください。',
   main:{label:'書き出し設定を確認',run:()=>actions.goExport?.()}
  });
 }
 return {show,close,isOpen:()=>!root.hidden,current:()=>pending,
  showGoalIntro,analysisFinished,goalReviewFinished,highlightReviewFinished,
  exportFinished,exportFailed};
}
