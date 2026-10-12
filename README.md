# PeakStamp — Audio Highlights

> Hear the hype. Mark the moment.

iPhoneの写真ライブラリに残った試合動画を、**スマートフォンのブラウザ内だけで音声解析**し、YouTubeコメント用タイムスタンプを生成します。

## MVPでできること

- MOV / MP4 / M4V / 音声ファイルを選択（アップロード不要）
- 音声の音量上昇からハイライト候補を抽出
- 検出感度・件数・盛り上がりの何秒前を示すか調整
- 動画を再生して候補を確認、時刻・説明の編集、除外・削除
- タイムスタンプをまとめてコピーし、YouTubeのコメント欄に貼り付け

## iPhoneで使う

GitHub Pages公開後、iPhoneのSafariで **https://nyamokun5.github.io/peakstamp/** を開きます。

1. 「iPhoneの動画を選択」から動画を選ぶ
2. 「音声を解析する」をタップ
3. ピーク候補を再生確認し、必要ならタイトルやタイムスタンプを調整
4. 「コメントをコピー」をタップし、YouTubeのコメント欄へ貼り付ける

**YouTubeにアップロードするものと、解析する動画を同じ長さ・同じ開始位置にしてください。**
動画をトリミングすると時刻がずれます。

## GitHub Pagesを有効にする（初回のみ）

このリポジトリで **Settings → Pages → Build and deployment** を開き、
**Source = Deploy from a branch / Branch = main / Folder = /(root)** にして **Save**。
反映後は上記URLでアクセスできます。

## 技術・プライバシー

- 静的HTML + CSS + JavaScript（APIキー / ログイン / DB / サーバー不要）
- mediabunny 1.61.3 を初回にCDNからダウンロード。WebCodecsで動画の音声を逐次デコード
- 動画ファイル自体はCDNにもGitHubにも送信しない
- 音声を0.25秒ごとに集計して、直前との音量差・ピーク強度を採点
- **音量の上昇のみを検出**。歓声、風、雑談、大声の指示などは区別しません
- iPhone Safariと実際の大型MOV / MP4ファイルでの実機検証はまだ必要です
- Safariを閉じると解析が中断します。解析中はアプリを前面に

## 開発・テスト

```bash
python3 -m http.server 8000
# http://localhost:8000/
node --test tests/*.test.mjs
node --check app.mjs
node --check detector.mjs
```

YouTubeへ動画・コメントを自動投稿する機能はありません。解析後にコメントをコピーして手動で投稿します。
