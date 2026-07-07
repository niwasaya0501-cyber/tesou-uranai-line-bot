# 手相占いLINE Bot

LINE公式アカウントに送った手のひらの写真を、OpenAI (gpt-4o-mini Vision) で手相鑑定し、結果をLINEで返すBotです。バックエンドはVercel Serverless Functions。課金が発生するのはOpenAI APIのみで、それ以外は無料枠で構成できます。

## ディレクトリ構成

```
手相占い/
├── api/
│   ├── webhook.js         # LINE Webhook（友だち追加時のあいさつ等）
│   ├── liff-submit.js     # LIFFからの「画像＋悩み」を受けて鑑定→LINEへPush送信
│   └── liff-config.js     # フロント(LIFF)にLIFF_IDを渡すAPI
├── lib/
│   ├── line.js            # LINE Push送信／Webhook署名検証
│   ├── openai.js          # OpenAI Vision呼び出し・プロンプト生成／ラリー用のテキスト会話
│   ├── image.js           # sharpでのリサイズ・EXIF除去
│   └── conversation.js    # Upstash Redisでの会話セッション保存（ラリー機能用）
├── public/
│   ├── index.html         # LIFF画面（悩み5択＋画像選択）
│   ├── app.js              # LIFF初期化／送信処理
│   ├── style.css
│   └── images/
│       └── line-banner.jpg  # LINE Flex Messageのヘッダー画像（紫と月のテーマ）
├── .env.example
├── package.json
├── vercel.json
└── README.md
```

## 処理の流れ

1. ユーザーが公式アカウントを友だち追加 → `follow`イベントがWebhookに届く → LIFFへのボタン付きメッセージを返信
2. ユーザーがボタンをタップ → LIFF画面が開く
3. 悩み（恋愛／仕事／人間関係／自己分析／その他）を選択し、写真を選ぶ（「その他」を選ぶと自由入力欄が表示され、具体的な悩みをテキストで入力できる）
4. ブラウザ側で軽くリサイズしてから `/api/liff-submit` にPOST
5. サーバー側でsharpにより最終リサイズ（長辺768px・EXIF除去）→ OpenAI Visionで鑑定 → LINE Push Messageで結果を送信（鑑定に成功した場合は、続けて「気になることがあれば質問してください」という案内メッセージも送る）
6. LIFF画面に「結果をLINEに送りました」と表示
7. 鑑定結果はセッションとして保存され、ユーザーがそのままLINEのトークで質問を続けると、鑑定結果を踏まえてAIが返信する（「ラリー」機能。詳細は本README末尾を参照）

---

## 1. 事前準備

- Node.js（18以上推奨）
- [Vercel](https://vercel.com/) アカウント（無料枠でOK）
- LINEアカウント（LINE Developersにログインするため）
- [OpenAI Platform](https://platform.openai.com/) アカウント・APIキー

## 2. LINE Developersでの設定（新規チャンネル作成）

今回は新しいLINE公式アカウントを使うため、以下をゼロから作成します。

### 2-1. プロバイダーとMessaging APIチャンネルの作成

1. [LINE Developers Console](https://developers.line.biz/console/) にログイン
2. 「新規プロバイダー作成」→ 名前を入力して作成
3. 作成したプロバイダーの中で「新規チャンネル作成」→「Messaging API」を選択
4. チャンネル名・説明・カテゴリなどを入力して作成
5. 作成後、チャンネルの「チャンネル基本設定」タブで **チャンネルシークレット** を確認（`LINE_CHANNEL_SECRET`）
6. 「Messaging API設定」タブで **チャンネルアクセストークン（長期）** を発行（`LINE_CHANNEL_ACCESS_TOKEN`）
7. 同じ「Messaging API設定」タブで以下を設定：
   - **応答メッセージ**：オフ（Bot側で全て制御するため）
   - **あいさつメッセージ**：オフ（Webhookの`follow`イベントで自前のあいさつを送るため、重複防止）
   - **Webhookの利用**：オン（Webhook URLはVercelデプロイ後に設定するため、この時点では一旦保留でOK）

### 2-2. LINEログインチャンネル＋LIFFアプリの作成

#### そもそも「LINEログインチャンネル」とは？

LINE Developersでは、1つの目的ごとに「チャンネル」という単位を作ります。

- **Messaging APIチャンネル**（2-1で作ったもの）＝ Bot本体（メッセージの送受信を行う）
- **LINEログインチャンネル**＝ LIFF（LINEアプリの中で動くミニWebアプリ機能）を管理するための、Bot本体とは別の入れ物

Messaging APIチャンネルの管理画面には「LIFF」というタブ自体は表示されますが、実際にそこを開くと **「LINEログインチャネルを使用してください」「Messaging APIチャネルには、LIFFアプリを追加できません」** という案内が出ます（2019年11月の仕様変更以降、Messaging APIチャンネルへの直接追加はできなくなりました）。そのため、LIFFアプリは必ず**別のLINEログインチャンネル**の中に作る必要があります。

- 同じ「プロバイダー」の中に、Messaging APIチャンネルとLINEログインチャンネルの2つが並んで存在するイメージです（プロバイダー＝会社やサービス単位の大きな箱、チャンネル＝その中の個別機能、と考えるとわかりやすいです）
- なお、LINEの案内には「LINEミニアプリ」という新ブランドへの統合予定についても書かれていますが、これは日本または台湾で法人承認を受けた事業者向けの機能のため、個人利用の場合は引き続き通常の「LIFFアプリ」を使えばOKです

#### 手順

1. LINE Developers Consoleで、2-1と同じプロバイダーのページを開く（画面左側の「プロバイダー」一覧、または パンくずリストの「AIエンジニア」のようなプロバイダー名をクリックすると、そのプロバイダー配下のチャンネル一覧が表示されます）
2. チャンネル一覧の画面にある **「Create a new channel」**（日本語表示なら「新規チャンネル作成」）ボタンをクリック
3. チャンネルタイプの選択画面が出るので、**「LINEログイン」**を選ぶ（「Messaging API」ではないので注意）
4. 必須項目を入力する
   - チャンネルアイコン：任意（後で設定・変更できるので空欄でOK）
   - チャンネル名：任意（例：手相占いLIFF）
   - チャンネル説明：任意で簡単に（例：手相占いBotのLIFF画面用）
   - **アプリタイプ**：**「ウェブアプリ」** にチェック（「ネイティブアプリ」はチェック不要）。LIFFはLINEアプリ内蔵のブラウザでWebページを表示する仕組みのため、iOS/Android向けにLINE SDKを組み込んだ専用アプリを作る場合に使う「ネイティブアプリ」は今回関係ありません
   - メールアドレス等、必須マークが付いている項目は入力
5. 利用規約に同意して「作成」をクリック
6. 作成が完了すると、そのチャンネルの管理画面に移動する。上部に並んでいるタブの中から **「LIFF」タブ** をクリック（このチャンネルではLIFFタブが正常に機能します）
7. 「追加」ボタンをクリックし、LIFFアプリの設定画面を開く
8. 以下を入力する
   - **LIFFアプリ名**：任意（例：手相占い）
   - **サイズ**：`Full` を推奨（画面いっぱいに表示されるタイプ）
   - **エンドポイントURL**：Vercelにデプロイした後のURL（例：`https://your-app.vercel.app/`）。まだVercelのURLが決まっていない場合は、一旦仮の値（`https://example.com/`）を入れておいて、3章でデプロイが終わってから正式なURLに直せばOKです
   - **Scope**：`profile` に必ずチェックを入れる（このチェックがないと、LIFF画面でユーザーを特定できず、鑑定結果をその人に送れなくなります）
   - **友だち追加オプション（ボットリンク機能）**：**「オン（通常）」** を推奨。本Botは鑑定結果をLINEのPush Messageで送るため、ユーザーが公式アカウントを友だち追加していないと結果が届きません。通常の動線（あいさつメッセージのボタン→LIFF）ではすでに友だち追加済みのはずですが、万が一友だち追加前にLIFFが開かれた場合の保険として「オン（通常）」にしておくと安全です
   - それ以外の項目は未設定のままで問題ありません
9. 「追加」を押すとLIFFアプリが作成され、一覧に **LIFF ID**（`1234567890-abcdefgh`のような、数字とハイフンと英数字が並んだ文字列）が表示されるので、これをコピーして控えておく（`.env`の`LIFF_ID`にこの値を入れます）

> **注意**：ここで発行されるLIFFの「エンドポイントURL」と、2-1のMessaging APIチャンネルで設定する「Webhook URL」は全く別のものです。前者はLIFF画面（ブラウザ）が読み込まれるURL、後者はLINEサーバーからのイベント通知を受け取るURLで、役割が違います。混同しないよう注意してください。

## 3. Upstash Redis（会話の一時保存）の作成

鑑定結果のあと、LINEのトークで続けて質問できる「ラリー」機能のために、会話履歴を一時的に保存する無料のデータストアを用意します。VercelのStorage連携から作成でき、OpenAI以外は引き続き無料枠内に収まります。

1. Vercelダッシュボードの左メニュー（プロジェクトを開く前の、チーム全体の画面）から **`ストレージ`** を開く（プロジェクトの中に入っている場合は、左メニューの **`ストレージ`** からでもOK）
2. **`Create Database`**（データベースを作成）→ **`Upstash`** → **`Redis`** を選択
3. 無料プラン（Free）のまま、リージョンなどはデフォルトで作成
4. 作成後、対象のVercelプロジェクト（`tesou-uranai-line-bot-iqyz`）に **`Connect`**（接続）する
5. 接続すると、`KV_REST_API_URL` と `KV_REST_API_TOKEN` という2つの環境変数が、そのプロジェクトに自動で追加されます（手動でコピーする必要はありません）
6. ローカルでも動作確認したい場合は、Redisデータベースの画面にある「.env」タブ等からこの2つの値を確認し、ローカルの`.env`にも追記してください

## 4. Vercelへのデプロイ

### 4-1. 初回デプロイ

```bash
npm install -g vercel   # 未インストールの場合
cd 手相占い
vercel login
vercel                  # プロジェクトをリンク（初回は質問に答えて設定）
```

### 4-2. 環境変数の設定

Vercelダッシュボード（Project Settings > Environment Variables）、またはCLIで設定します。

```bash
vercel env add LINE_CHANNEL_SECRET
vercel env add LINE_CHANNEL_ACCESS_TOKEN
vercel env add OPENAI_API_KEY
vercel env add LIFF_ID
```

（`KV_REST_API_URL` と `KV_REST_API_TOKEN` は、3章でVercelプロジェクトに接続していれば自動で追加済みです）

（`.env.example` を参考に、Production / Preview / Development すべてに登録してください）

ローカルで動作確認したい場合は `.env.example` をコピーして `.env` を作成し、実際の値を入れてください（`.env` は `.gitignore` 済みでコミットされません）。

### 4-3. 本番デプロイ

```bash
vercel --prod
```

デプロイ完了後に表示されるURL（例：`https://your-app.vercel.app`）を控えます。

### 4-4. LINE側の設定をURLで確定させる

1. LIFFアプリの **エンドポイントURL** を `https://your-app.vercel.app/` に更新（LINEログインチャンネル > LIFF タブ）
2. Messaging APIチャンネルの **Webhook URL** を `https://your-app.vercel.app/api/webhook` に設定し、「検証」ボタンで疎通確認
3. 「Webhookの利用」がオンになっていることを再確認

## 5. 動作確認

1. Messaging APIチャンネルの「Messaging API設定」タブにあるQRコードで、公式アカウントを友だち追加
2. 友だち追加直後に「手相を占う」ボタン付きのメッセージが届くことを確認
3. ボタンをタップ → LIFF画面が開くことを確認
4. 悩みを選択 → 手のひらの写真を選択 →「この写真で占う」をタップ
5. 「鑑定中です…」→ 数秒〜数十秒後に「結果をLINEに送りました」と表示され、LINEのトークに鑑定結果が届くことを確認
6. 続けてLINEのトークに何かメッセージを送ると、鑑定結果を踏まえた返信が届くことを確認（ラリー機能）

## 6. 環境変数一覧

| 変数名 | 説明 | 確認場所 |
|---|---|---|
| `LINE_CHANNEL_SECRET` | Messaging APIチャンネルのシークレット | LINE Developers > Messaging APIチャンネル > チャンネル基本設定 |
| `LINE_CHANNEL_ACCESS_TOKEN` | 長期チャンネルアクセストークン | LINE Developers > Messaging APIチャンネル > Messaging API設定 |
| `OPENAI_API_KEY` | OpenAI APIキー | OpenAI Platform > API keys |
| `LIFF_ID` | LIFFアプリのID | LINE Developers > LINEログインチャンネル > LIFF |
| `KV_REST_API_URL` | 会話セッション保存用RedisのURL | Vercel > Storage > 作成したUpstash Redis |
| `KV_REST_API_TOKEN` | 同上のアクセストークン | Vercel > Storage > 作成したUpstash Redis |

## 7. コストに関する注意

- 課金が発生するのはOpenAI APIのみです。Vercel・LINE Messaging API・Upstash Redisはいずれも無料枠内で運用できます
- LINE Push Messageはフリープランで月500通まで無料です
- 画像はサーバー側で長辺768pxにリサイズしてからOpenAIに送るため、1回あたりのAPIコストを抑えています
- `max_tokens`（`lib/openai.js`内）で出力上限を設定し、応答の暴走・コスト増加を防いでいます
- 両手（2枚）で鑑定した場合、画像1枚あたりのコストが単純計算で2倍になりますが、gpt-4o-miniは非常に低価格なため、1回あたりの負担は引き続き小さいです
- ラリー（鑑定後のLINEトークでの続きの会話）は**テキストのみ**で行い、画像は再送しないため、1往復あたりのコストは非常に小さいです（目安：1ユーザーが10往復しても1円未満）。1鑑定あたり最大10往復（`lib/conversation.js`の`MAX_TURNS`）で自動的に打ち切り、際限のないコスト増加を防いでいます

## 8. リッチメニューを設定したい場合（任意）

現在の構成では、友だち追加時のメッセージ内のボタンからLIFFを開けるため、リッチメニューがなくてもBotは機能します。見た目を良くしたい場合は以下の手順で追加できます。

1. [LINE Official Account Manager](https://manager.line.biz/) にログイン
2. 「メッセージ配信」→「リッチメニュー」で画像をアップロードし、タップ領域のリンク先に `https://liff.line.me/{LIFF_ID}` を設定
3. 保存後、トーク画面下部にメニューとして表示されます

## 9. トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| Webhookの「検証」で失敗する | URLが違う／デプロイ前 | `https://your-app.vercel.app/api/webhook` になっているか確認し、再デプロイ後に再検証 |
| `Authentication failed`（LINE API） | チャンネルアクセストークンが違う | 長期トークンを再発行し、環境変数を更新して再デプロイ |
| LIFFが真っ白のまま開かない | LIFF IDが違う／エンドポイントURL未更新 | `LIFF_ID`の環境変数と、LIFFアプリ側のエンドポイントURLを再確認 |
| 「結果をLINEに送りました」と出るのにLINEに届かない | ユーザーが公式アカウントを友だち追加していない、またはブロックしている | 友だち追加状態を確認 |
| 鑑定に時間がかかりタイムアウトする | 画像サイズが大きい／Vercelプランの実行時間上限 | `vercel.json`の`maxDuration`を確認し、プランの上限内に収まっているか確認 |
| OpenAIの応答が毎回「もう一度送ってください」になる | 手のひら全体が写っていない、または暗すぎる/ぶれている | 明るい場所で手のひら全体が写るように撮影し直す |
| デザイン変更後もLIFF画面で一瞬だけ古い見た目が表示される | ブラウザ側に古い`style.css`/`app.js`がキャッシュされている | `vercel.json`の`headers`で`index.html`/`app.js`/`style.css`に`no-cache`を設定済み。それでも直らない場合はLINEアプリのキャッシュ削除、またはLIFFを一度友だちリストから開き直す |
| 鑑定後にLINEでメッセージを送っても「LIFFを開いてください」としか返らない | `KV_REST_API_URL`/`TOKEN`が未設定、またはセッションが24時間で期限切れ | 環境変数を確認して再デプロイ。期限切れの場合は新しく鑑定し直す |

## 10. 悩みの選択肢を変更したい場合

`public/index.html` の `.worry-btn` と、`lib/openai.js` / `public/app.js` の `WORRY_LABELS` を同じキーで揃えて編集してください（3箇所とも `key` を一致させる必要があります）。

## 11. ラリー（鑑定後の続きの会話）について

鑑定結果を送った後、ユーザーがそのままLINEのトークにメッセージを送ると、直前の鑑定結果を踏まえてAIが返信します（`api/webhook.js`のテキストメッセージ処理）。

- 会話は`lib/conversation.js`経由でUpstash Redisに一時保存され、**24時間**で自動的に消えます
- 1回の鑑定につき**最大10往復**（`MAX_TURNS`）まで。それを超えると「このやりとりは一旦ここまで」という案内を送り、セッションを削除して打ち切ります。再度鑑定すれば、また新しく10往復分のラリーができます
- ラリーの返信は**画像を再送しないテキストのみ**のやり取りのため、コストは非常に小さく抑えられています（詳細は「7. コストに関する注意」を参照）
- 鑑定を一度もしていない状態でメッセージを送ると、セッションが存在しないため「LIFFを開いてください」という案内が返ります
- 往復上限や保存期間を変更したい場合は、`lib/conversation.js`の`MAX_TURNS`・`TTL_SECONDS`を編集してください
