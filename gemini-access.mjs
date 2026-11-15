// Both source modes share the same tab lifetime and opt-in device storage.
const TAB='peakstamp_gemini_access_tab_v1',DEVICE='peakstamp_gemini_access_device_v1',TTL=4*60*60*1000;
export function initGeminiAccess(field,remember,{session=globalThis.sessionStorage,device=globalThis.localStorage,now=()=>Date.now()}={}){
 let saved='',tab='';
 try{saved=device.getItem(DEVICE)||''}catch{}
 try{const v=JSON.parse(session.getItem(TAB)||'null');if(typeof v?.code==='string'&&v.code&&v.expiresAt>now()&&v.expiresAt<=now()+TTL)tab=v.code;else session.removeItem(TAB)}catch{}
 field.value=saved||tab;if(remember)remember.checked=Boolean(saved);
 const persist=()=>{const code=field.value.trim();try{if(code)session.setItem(TAB,JSON.stringify({code,expiresAt:now()+TTL}));else session.removeItem(TAB)}catch{}
 try{if(remember?.checked&&code)device.setItem(DEVICE,code);else device.removeItem(DEVICE)}catch{}};
 field.addEventListener('change',persist);remember?.addEventListener('change',persist);
 return {persist};
}
