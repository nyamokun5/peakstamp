export const youtubeTestMode=globalThis.document?.body?.dataset?.ssAnalysis==='staging';
export const youtubeWorker=youtubeTestMode?'https://shoot-sunday-sync-staging.yomax1979.workers.dev':'https://shoot-sunday-sync.yomax1979.workers.dev';
export const youtubeApi=path=>youtubeTestMode?'./api/yt-'+path:youtubeWorker+'/youtube/'+path;
export const youtubeEnvironment=youtubeTestMode?'staging':'production';
