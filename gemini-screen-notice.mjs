/**
 * Keep novice workflow focused: hide Gemini form until an actual video is loaded,
 * and remind users that Safari must stay foregrounded during audio extraction.
 * No processing, caching, consent or paid API behavior is changed here.
 */
export function updateGeminiScreenNotice({
  panel,warning,title,description,hasSource=false,processing=false
}={}) {
  if(panel)panel.hidden=!hasSource;
  if(!warning)return;
  warning.hidden=!hasSource;
  warning.classList.toggle('is-processing',Boolean(processing));
  if(title)title.textContent=processing
    ? '解析中：この画面を開いたままにしてください'
    : '解析中はこの画面を開いたままにしてください';
  if(description)description.textContent=processing
    ? '他のアプリへの切り替えや画面ロックで処理が中断される場合があります。'
    : 'LINEなど他のアプリへ切り替えたり、画面をロックすると解析が止まる場合があります。';
}
