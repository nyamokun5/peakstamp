import {chooseIdentity} from './sposched-name-resolution.mjs';

/**
 * Compact, accessible chooser for an unresolved SS identity.
 * No network calls, no writes. The caller owns the draft and must
 * revalidate against the authoritative SS roster before submission.
 */
export function renderIdentityChoice({document:d,container,result,onChoose,onSkip}) {
 if(!d?.createElement||!container?.replaceChildren||result?.status!=='unresolved')
  throw Error('名寄せ候補の表示条件が不正です');
 const el=(tag,text)=>{const n=d.createElement(tag);n.textContent=text;return n};
 const wrap=el('div','');wrap.className='ss-name-choice';
 const heading=el('p',(result.role==='assist'?'アシスト':'得点者')+'：「'+(result.spoken||'不明')+'」');
 wrap.append(heading);
 const select=el('select','');select.setAttribute('aria-label','正式な選手を選択');
 const blank=el('option','選手を選択');blank.value='';select.append(blank);
 for(const candidate of result.candidates||[]){
  const option=el('option',candidate.name);option.value=candidate.player_id;
  select.append(option);
 }
 wrap.append(select);
 const confirm=el('button','決定');confirm.type='button';confirm.disabled=true;
 select.addEventListener('change',()=>{confirm.disabled=!select.value});
 confirm.addEventListener('click',()=>{
  if(!select.value)return;
  onChoose(chooseIdentity(result,select.value));
 });
 wrap.append(confirm);
 if(result.role==='assist'&&typeof onSkip==='function'){
  const skip=el('button','アシストなし');skip.type='button';
  skip.addEventListener('click',()=>onSkip({status:'none',role:'assist'}));
  wrap.append(skip);
 }
 container.replaceChildren(wrap);
 return {element:wrap,select,confirm};
}
