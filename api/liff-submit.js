const { resizeForVision } = require('../lib/image');
const { readPalm, WORRY_LABELS, UNREADABLE_MESSAGE, buildFollowUpInvite } = require('../lib/openai');
const { pushMessage, pushMessages } = require('../lib/line');
const { saveSession } = require('../lib/conversation');

// 鑑定結果の案内メッセージに添える「続きを話す／新しく占う」の2択
function buildContinueQuickReply() {
  return {
    items: [
      {
        type: 'action',
        action: { type: 'message', label: '続きを話す', text: '続きを聞きたいです' },
      },
      {
        type: 'action',
        action: {
          type: 'uri',
          label: '新しく占う',
          uri: `https://liff.line.me/${process.env.LIFF_ID}`,
        },
      },
    ],
  };
}

// 手前でクライアント側リサイズ済みだが、念のため異常に大きいリクエストは弾く
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 2;
const MAX_WORRY_TEXT_LENGTH = 100;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const { userId, worry, images } = req.body || {};
  let { worryText } = req.body || {};

  if (!userId || typeof userId !== 'string' || !userId.startsWith('U')) {
    res.status(400).json({ error: 'invalid userId' });
    return;
  }
  if (!worry || !WORRY_LABELS[worry]) {
    res.status(400).json({ error: 'invalid worry' });
    return;
  }
  if (worry === 'other') {
    if (typeof worryText !== 'string' || !worryText.trim()) {
      res.status(400).json({ error: 'worryText is required when worry is "other"' });
      return;
    }
    worryText = worryText.trim().slice(0, MAX_WORRY_TEXT_LENGTH);
  } else {
    worryText = null;
  }
  if (
    !Array.isArray(images) ||
    images.length < 1 ||
    images.length > MAX_IMAGES ||
    images.some((img) => typeof img !== 'string')
  ) {
    res.status(400).json({ error: `1〜${MAX_IMAGES}枚の画像が必要です` });
    return;
  }

  try {
    const inputBuffers = images.map((imageBase64) => {
      const base64Data = imageBase64.includes(',')
        ? imageBase64.split(',')[1]
        : imageBase64;
      const buffer = Buffer.from(base64Data, 'base64');

      if (buffer.length > MAX_INPUT_BYTES) {
        throw new Error('image too large');
      }

      return buffer;
    });

    const resizedBuffers = await Promise.all(inputBuffers.map(resizeForVision));
    const resizedBase64Images = resizedBuffers.map((buf) => buf.toString('base64'));

    // 画像の中身は記録せず、サイズだけログに残す（「読み取れません」が続く場合の切り分け用）
    console.log(
      `liff-submit: images=${resizedBuffers.length}, sizes=${resizedBuffers
        .map((b) => `${b.length}bytes`)
        .join(',')}, worry=${worry}`
    );

    const resultText = await readPalm(resizedBase64Images, worry, worryText);
    const isUnreadable = resultText.includes(UNREADABLE_MESSAGE);

    // 読み取れなかった場合は「続けて質問できます」の案内は不要なので、鑑定結果のみ送る
    if (isUnreadable) {
      await pushMessage(userId, resultText);
    } else {
      await pushMessages(userId, [
        { type: 'text', text: resultText },
        {
          type: 'text',
          text: buildFollowUpInvite(worry, worryText),
          quickReply: buildContinueQuickReply(),
        },
      ]);
    }

    // 読み取れた場合のみ、この後LINEのトークで続きの質問ができるようセッションを保存する。
    // ここが失敗しても鑑定結果自体は既に届いているので、レスポンスは成功のままにする
    if (!isUnreadable) {
      try {
        await saveSession(userId, {
          worry,
          worryText,
          readingText: resultText,
          turns: [],
          turnCount: 0,
        });
      } catch (sessionErr) {
        console.error('saveSession error:', sessionErr);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('liff-submit error:', err);
    res.status(500).json({ error: 'internal error' });
  }
};
