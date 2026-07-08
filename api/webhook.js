const {
  verifySignature,
  replyMessage,
  buildContinueQuickReply,
  buildEndOfRallyQuickReply,
} = require('../lib/line');
const { continueChat } = require('../lib/openai');
const { getSession, saveSession, deleteSession, MAX_TURNS } = require('../lib/conversation');

// ユーザーが「消して」等と送ったら、いつでもその場でセッション(鑑定内容・やりとり)を削除できるようにする
function isDeleteRequest(text) {
  return text.includes('消して') || text.includes('削除');
}

// 往復上限到達時に出す「消す/残す」の選択肢のうち、「残す」への返答判定
function isKeepRequest(text) {
  return text.includes('残す') || text.includes('残して');
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// LINEの「ボタンテンプレート」はボタンの色や背景色を変更できないため、
// より柔軟に装飾できるFlex Messageで、紫と月をテーマにしたデザインにしている
function liffButtonMessage(altText, text, baseUrl) {
  return {
    type: 'flex',
    altText,
    contents: {
      type: 'bubble',
      hero: {
        type: 'image',
        url: `${baseUrl}/images/line-banner.jpg`,
        size: 'full',
        aspectRatio: '3:2',
        aspectMode: 'cover',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#F8EEF8',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text,
            wrap: true,
            color: '#7A5A94',
            size: 'sm',
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#F8EEF8',
        paddingAll: '12px',
        paddingTop: '0px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#6A3F96',
            action: {
              type: 'uri',
              label: '手相を占う',
              uri: `https://liff.line.me/${process.env.LIFF_ID}`,
            },
          },
        ],
      },
    },
  };
}

async function handleEvent(event, baseUrl) {
  if (event.type === 'follow') {
    await replyMessage(event.replyToken, [
      liffButtonMessage(
        '友だち追加ありがとうございます！',
        '友だち追加ありがとうございます！\n下のボタンから手のひらの写真を送って、手相を占ってみましょう。',
        baseUrl
      ),
    ]);
    return;
  }

  if (event.type === 'message' && event.message.type === 'text') {
    const userId = event.source.userId;

    // Redis(Upstash)の障害・設定不備でここが失敗しても、
    // 「セッションなし」として扱いLIFF誘導を返す(無反応にしない)
    let session = null;
    if (userId) {
      try {
        session = await getSession(userId);
      } catch (err) {
        console.error('getSession error:', err);
      }
    }

    // 直前に鑑定したセッションがなければ、LIFFへ誘導するだけにする
    if (!session) {
      await replyMessage(event.replyToken, [
        liffButtonMessage(
          '手相を占う',
          '手相を占うには、下のボタンをタップしてください。',
          baseUrl
        ),
      ]);
      return;
    }

    // 「消して」等が送られたら、往復回数によらずいつでもその場でセッションを削除する
    if (isDeleteRequest(event.message.text)) {
      try {
        await deleteSession(userId);
      } catch (err) {
        console.error('deleteSession error:', err);
      }
      await replyMessage(event.replyToken, [
        {
          type: 'text',
          text: 'これまでの鑑定内容とやりとりを削除しました。またいつでも新しく手相を占ってくださいね。',
        },
      ]);
      return;
    }

    // 「残す」は、往復上限到達時に出す選択肢への返答用。何もせず現状維持でよいことを伝えるだけ
    if (isKeepRequest(event.message.text)) {
      await replyMessage(event.replyToken, [
        { type: 'text', text: '承知しました。このまま残しておきますね。' },
      ]);
      return;
    }

    // 往復上限に達していたら、そこで会話を打ち切る。
    // 内容を自動削除するのではなく、消すか残すかをユーザー自身に選んでもらう
    if (session.turnCount >= MAX_TURNS) {
      await replyMessage(event.replyToken, [
        liffButtonMessage(
          '手相を占う',
          'このやりとりは一旦ここまでとさせていただきますね。また新しく手相を占いたいときは、下のボタンをタップしてください！',
          baseUrl
        ),
        {
          type: 'text',
          text: 'これまでの鑑定内容とやりとりは消しますか？残しますか？（残す場合も24時間経つと自動的に削除されます）',
          quickReply: buildEndOfRallyQuickReply(),
        },
      ]);
      return;
    }

    // OpenAI呼び出しが失敗しても無反応にせず、LIFFへの案内を返す
    let replyText;
    try {
      replyText = await continueChat({
        readingText: session.readingText,
        worry: session.worry,
        worryText: session.worryText,
        turns: session.turns,
        userMessage: event.message.text,
      });
    } catch (err) {
      console.error('continueChat error:', err);
      await replyMessage(event.replyToken, [
        liffButtonMessage(
          '手相を占う',
          '少し混み合っているようです。少し時間をおいてから、もう一度メッセージを送るか、下のボタンから新しく占ってみてください。',
          baseUrl
        ),
      ]);
      return;
    }

    // 保存が失敗しても、既に生成できた返信は届ける(次回以降の文脈は引き継げないだけにする)
    try {
      await saveSession(userId, {
        ...session,
        turns: [
          ...session.turns,
          { role: 'user', content: event.message.text },
          { role: 'assistant', content: replyText },
        ],
        turnCount: session.turnCount + 1,
      });
    } catch (err) {
      console.error('saveSession error:', err);
    }

    // 続けて質問できることが伝わるよう、固定の一言を毎回添える
    // (AIに生成させず固定文言にすることで、コストと文言のブレを抑える)
    const replyWithHint = `${replyText}\n\n他に気になることがあれば、続けて聞いてくださいね。`;

    // 「終わり？」と紛らわしくなる大きなボタン付きメッセージは出さず、
    // 目立たないクイックリプライで「新しくする」を毎回選べるようにする
    await replyMessage(event.replyToken, [
      { type: 'text', text: replyWithHint, quickReply: buildContinueQuickReply() },
    ]);
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).send('OK');
    return;
  }

  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers['x-line-signature'];

    if (!verifySignature(rawBody, signature)) {
      res.status(401).send('invalid signature');
      return;
    }

    const body = JSON.parse(rawBody.toString('utf-8'));
    const events = body.events || [];

    // バナー画像のURLを組み立てるため、リクエストされたホスト名を使う
    // （カスタムドメインに変更しても自動で追従する）
    const baseUrl = `https://${req.headers.host}`;

    await Promise.all(events.map((event) => handleEvent(event, baseUrl)));

    res.status(200).send('OK');
  } catch (err) {
    // ここでエラーが出る場合、Vercelの環境変数(LINE_CHANNEL_SECRET等)が
    // 未設定/不正な可能性が高い。詳細はVercelのFunction Logsで確認する
    console.error('webhook handling error:', err);
    res.status(200).send('OK');
  }
}

// 署名検証にraw bodyが必要なため、自動JSONパースを無効化する
handler.config = {
  api: {
    bodyParser: false,
  },
};

module.exports = handler;
