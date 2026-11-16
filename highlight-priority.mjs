// Display policy only. Never removes analysis, goals or export selections.
const defaultTitles={goal_reaction:'ゴール',save_reaction:'ナイスキーパー',shot_reaction:'惜しい！',excited_reaction:'ナイスプレイ！',other:'ナイスプレイ！',uncertain:'ナイスプレイ！'};
export function primaryHighlight(item){
 if(!item)return false;
 if(item.goalRecordId||item.goalVideoOwned||item.goal||item.geminiType==='goal_reaction')return true;
 if(item.enabled===true||item.highlightUserEdited===true||Number.isFinite(item.manualEnd)||
    Number(item.zoom)>1.02)return true;
 // Manual/offline scenes are outside the AI-reaction filter.
 if(item.origin!=='gemini'&&!item.geminiType)return true;
 if(item.title&&defaultTitles[item.geminiType]&&item.title!==defaultTitles[item.geminiType])return true;
 // Use heard words, never the generated title, reason or AI type alone.
 const quote=String(item.geminiQuote||'').normalize('NFKC').toLowerCase()
  .replace(/[\u30a1-\u30f6]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
 return /ないしゅ[ーう]|ないすしゅ[ーう]と|ないすき(?:ーぱー|ー)|ないすせ[ーえ]ぶ|惜し[いー]|おし[いー]|\bnice\s+(?:shot|save)\b|\b(?:near[ -]miss|so close)\b/u.test(quote);
}
export function sceneInReviewTab(item,tab='all'){
 if(tab==='kept')return item.enabled===true;
 if(tab==='reviewed')return true;
 const undecided=item.enabled!==true&&item.rejected!==true;
 return undecided&&(tab==='other'?!primaryHighlight(item):primaryHighlight(item));
}
