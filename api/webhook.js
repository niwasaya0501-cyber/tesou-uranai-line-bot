const { verifySignature, replyMessage } = require('../lib/line');

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
    await replyMessage(event.replyToken, [
      liffButtonMessage(
        '手相を占う',
        '手相を占うには、下のボタンをタップしてください。'
      ),
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
