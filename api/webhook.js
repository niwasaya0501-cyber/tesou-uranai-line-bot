const { verifySignature, replyMessage } = require('../lib/line');
const { continueChat } = require('../lib/openai');
const { getSession, saveSession, deleteSession, MAX_TURNS } = require('../lib/conversation');

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function liffButtonMessage(altText, text) {
  return {
    type: 'template',
    altText,
    template: {
      type: 'buttons',
      text,
      actions: [
        {
          type: 'uri',
          label: '手相を占う',
          uri: `https://liff.line.me/${process.env.LIFF_ID}`,
        },
      ],
    },
  };
}

async function handleEvent(event) {
  if (event.type === 'follow') {
    await replyMessage(event.replyToken, [
      liffButtonMessage(
        '友だち追加ありがとうございます！',
        '友だち追加ありがとうございます！\n下のボタンから手のひらの写真を送って、手相を占ってみましょう。'
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
          '手相を占うには、下のボタンをタップしてください。'
        ),
      ]);
      return;
    }

    // 往復上限に達していたら、そこで会話を打ち切って新しい鑑定を促す
    if (session.turnCount >= MAX_TURNS) {
      try {
        await deleteSession(userId);
      } catch (err) {
        console.error('deleteSession error:', err);
      }
      await replyMessage(event.replyToken, [
        {
          type: 'text',
          text: 'このやりとりは一旦ここまでとさせていただきますね。また手のひらの写真を送って、新しく占ってみてください！',
        },
      ]);
      return;
    }

    const replyText = await continueChat({
      readingText: session.readingText,
      worry: session.worry,
      worryText: session.worryText,
      turns: session.turns,
      userMessage: event.message.text,
    });

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

    await replyMessage(event.replyToken, [{ type: 'text', text: replyText }]);
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

    await Promise.all(events.map(handleEvent));

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
