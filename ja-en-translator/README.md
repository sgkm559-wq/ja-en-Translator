# LINEスタンプ クリエイター

Gemini APIを使って、スマホからLINEスタンプのコンセプト作成、画像生成、申請チェックまで進めるReact + Vite製PWAです。

## 使い方

1. Node.js LTS をインストール済みであることを確認
2. このフォルダで `npm install`
3. 開発起動: `npm run dev` → 表示されたURLをスマホまたはブラウザで開く
4. Google AI Studioで取得したGemini APIキーを入力
5. テーマと雰囲気を選んで、コンセプト生成 → 編集 → 画像生成 → 申請チェックへ進む

## スマホで使いやすくするポイント

- PWA対応のため、スマホブラウザの「ホーム画面に追加」からアプリ風に起動できます。
- APIキーや入力内容は同じ端末のlocalStorageに保存されます。共有端末では利用後にブラウザデータを削除してください。
- 生成画像は各カードの「保存」ボタンから端末に保存できます。

## 注意

- Gemini APIキーをフロントエンドに入力するBYOK方式です。本格運用ではサーバーまたはCloudflare Workerなどのプロキシでキーを保護してください。
- LINE Creators Marketへのアップロード前に、画像サイズ、PNG形式、ファイルサイズ、権利・表現面を必ず確認してください。


## 今この状況から続けるには（iPhoneのCodexで作業していた場合）

ここで作った修正版は、iPhoneやPC本体のフォルダではなく、Codexの作業用クラウド環境にあります。なので「iPhoneで作業したからPCの中に無い」のは正常です。続け方は次のどちらかです。

### いちばん簡単: CodexからGitHubへ反映して、Netlifyで公開する

1. PCでCodexを開き、この作業スレッドまたは作成済みPRを開く
2. 変更内容をGitHubへ反映（PRをマージ、またはブランチをpush）
3. NetlifyでGitHubリポジトリを選び、下の公開設定を入れる
4. Netlifyが発行したURLをiPhoneのChromeで開く
5. Gemini APIキーを入力してテストする
6. 問題なければiPhoneのホーム画面に追加する

この方法なら、PCにプロジェクトをコピーしなくてもスマホでテストできます。

### PCの中で開いてテストしたい場合

PCローカルで動かす場合だけ、PCへリポジトリを取得します。

```bash
git clone <GitHubのリポジトリURL>
cd ja-en-Translator/ja-en-translator
npm install
npm run dev -- --host 0.0.0.0
```

ターミナルに表示された `http://localhost:5173/` をPCで開きます。同じWi-FiのiPhoneから見るときは、PCのIPアドレスを使って `http://<PCのIPアドレス>:5173/` を開きます。

### 迷ったら

「使うためのテスト」なら、まずNetlifyなどで公開するのがおすすめです。`npm run dev` はPCローカル開発用なので、スマホだけで使いたい本番運用では必須ではありません。

## PCなしでスマホから使うには

このアプリはReact/Viteの静的Webアプリなので、スマホだけで日常利用したい場合は、最初に一度だけWebへ公開してください。公開後はPCを起動しなくても、発行されたURLをスマホのブラウザやホーム画面アイコンから開けます。

### おすすめ: Netlify / Vercel / Cloudflare Pagesへ公開

GitHubにこのリポジトリを置いたうえで、ホスティングサービス側で次の設定を使います。

| 項目 | 設定値 |
| --- | --- |
| Base / Root directory | `ja-en-translator` |
| Build command | `npm run build` |
| Publish / Output directory | `dist` |

Vite公式ガイドでも、本番用ビルドは `npm run build` で行い、標準の出力先 `dist` を任意の静的ホスティングへデプロイする流れです。このリポジトリでは、Netlify向けにルートの `netlify.toml` へ同じ設定を入れてあります。

### 公開後のスマホ利用手順

1. 公開されたURLをスマホで開く
2. Gemini APIキーを入力
3. ホーム画面に追加
4. 次回以降はホーム画面のアイコンから起動

`npm run dev` は開発中にPCで確認するためのコマンドです。スマホだけで使う運用では、公開URLを使うため毎回PCを挟む必要はありません。

### セキュリティ注意

現在はスマホのブラウザにGemini APIキーを保存するBYOK方式です。自分専用・少人数利用なら手軽ですが、誰でもアクセスできるURLとして公開する場合は、APIキーを直接アプリに埋め込まず、Cloudflare Workerなどのプロキシでキーを保護してください。
