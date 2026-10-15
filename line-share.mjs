/**
 * LINE explicitly supports ?openExternalBrowser=1 on ordinary HTTPS URLs.
 * The parameter must be part of the link the user taps in a LINE chat;
 * JavaScript cannot force LINE to switch browsers after a page is opened.
 */
export function addLineExternalBrowserParam(href) {
  const url=new URL(href);
  if(url.protocol!=='https:')throw new Error('HTTPS URLを指定してください');
  url.searchParams.set('openExternalBrowser','1');
  return url.href;
}

/** Strip page-only cache/version params when constructing a clean share URL. */
export function lineShareUrl(href) {
  const base=new URL('./',href);
  return addLineExternalBrowserParam(base.href);
}

/** Add the flag to the visible browser address, so copying the bar is safe. */
export function normalizeVisibleLineUrl(href) {
  const url=new URL(href);
  if(url.searchParams.get('openExternalBrowser')==='1')return null;
  return addLineExternalBrowserParam(url.href);
}
