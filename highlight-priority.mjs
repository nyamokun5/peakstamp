// Display policy only. Never removes analysis, goals or export selections.
import {DEFAULT_PEAK_BEFORE_SECONDS} from './editing-rules.mjs';
const defaultTitles={goal_reaction:'ゴール',save_reaction:'ナイスキーパー',shot_reaction:'惜しい！',excited_reaction:'ナイスプレイ！',other:'ナイスプレイ！',uncertain:'ナイスプレイ！'};
export function editedHighlight(item){
 return item.highlightUserEdited===true||item.origin==='manual'||Number.isFinite(item.manualEnd)||Number(item.zoom)>1.02||
  Number.isFinite(item.time)&&Number.isFinite(item.peakSeconds)&&Math.abs(item.time-Math.max(0,item.peakSeconds-DEFAULT_PEAK_BEFORE_SECONDS))>.05||
  Boolean(item.title&&defaultTitles[item.geminiType]&&item.title!==defaultTitles[item.geminiType]);
}
export function primaryHighlight(item){
 if(!item)return false;
 if(item.goalRecordId||item.goalVideoOwned||item.goal||item.geminiType==='goal_reaction')return true;
 if(item.enabled===true||editedHighlight(item))return true;
 // Manual/offline scenes are outside the AI-reaction filter.
 if(item.origin!=='gemini'&&!item.geminiType)return true;
 return highlightCueLabels(item).length>0;
}
export function sceneInReviewTab(item,tab='all'){
 if(tab==='kept')return item.enabled===true;
 if(tab==='reviewed')return true;
 const undecided=item.enabled!==true&&item.rejected!==true;
 return undecided&&(tab==='other'?!primaryHighlight(item):primaryHighlight(item));
}

const cuePatterns=[
 ['ナイシュー',/ないしゅ[ーう]|ないすしゅ[ーう]と|\bnice\s+shot\b/u],
 ['ナイスキー',/ないすき(?:ーぱー|ー)|ないすせ[ーえ]ぶ|\bnice\s+save\b/u],
 ['惜しい',/惜し[いー]|おし[いー]|\b(?:near[ -]miss|so close)\b/u]
];
export function highlightCueLabels(item){
 const quote=String(item?.geminiQuote||'').normalize('NFKC').toLowerCase()
  .replace(/[\u30a1-\u30f6]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
 return cuePatterns.filter(([,pattern])=>pattern.test(quote)).map(([label])=>label);
}
export function highlightKindLabel(item){
 if(item?.goalRecordId||item?.goalVideoOwned||item?.goal)return 'ゴール';
 if(item?.geminiType==='goal_reaction')return 'ゴール候補';
 const labels=highlightCueLabels(item);
 return labels.length?labels.join(' / '):String(item?.geminiQuote||'').trim()?'その他':'判定情報なし';
}
