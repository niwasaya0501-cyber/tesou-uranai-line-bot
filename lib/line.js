const crypto = require('crypto');

const LINE_API_BASE = 'https://api.line.me/v2/bot';

function verifySignature(rawBody, signature) {
  if (!signature) return false;
  const hash = crypto
    .createHmac('sha256', process.env.LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest('base64');
  return hash === signature;
}

async function callLineApi(path, body) {
  const res = await fetch(`${LINE_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE API error (${res.status}): ${text}`);
  }

  return res;
}

// クイックリプライ等を付けた生のメッセージオブジェクトをそのまま送りたい場合はこちらを使う
function pushMessages(userId, messages) {
  return callLineApi('/message/push', { to: userId, messages });
}

function pushMessage(userId, textOrTexts) {
  const texts = Array.isArray(textOrTexts) ? textOrTexts : [textOrTexts];
  return pushMessages(
    userId,
    texts.map((text) => ({ type: 'text', text }))
  );
}

function replyMessage(replyToken, messages) {
  return callLineApi('/message/reply', { replyToken, messages });
}

// 鑑定結果後・ラリー中の返信に添えるクイックリプライ。
// 「続きを聞く」ボタンは、案内文に「このまま質問してください」とすでに
// 書かれておりユーザーが迷う原因になるため置かず、「新しくする」のみにする
function buildContinueQuickReply() {
  return {
    items: [
      {
        type: 'action',
        action: {
          type: 'uri',
          label: '新しくする',
          uri: `https://liff.line.me/${process.env.LIFF_ID}`,
        },
      },
    ],
  };
}

module.exports = {
  verifySignature,
  pushMessage,
  pushMessages,
  replyMessage,
  buildContinueQuickReply,
};
