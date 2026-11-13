/** Prevent stale async SS preflight results from authorizing a new event.
 * Pure, no network or storage side effects.
 */
export function assertCurrentInlineEvent(snapshot,currentContext){
 if(!snapshot?.eventId||currentContext?.snapshot!==snapshot)
  throw Error('SSイベントが変更されました。最新のイベントで確認してください');
 return true;
}
