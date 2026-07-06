const { resizeForVision } = require('../lib/image');
const { readPalm, WORRY_LABELS } = require('../lib/openai');
const { pushMessage } = require('../lib/line');

// 手前でクライアント側リサイズ済みだが、念のため異常に大きいリクエストは弾く
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const { userId, worry, imageBase64 } = req.body || {};

  if (!userId || typeof userId !== 'string' || !userId.startsWith('U')) {
    res.status(400).json({ error: 'invalid userId' });
    return;
  }
  if (!worry || !WORRY_LABELS[worry]) {
    res.status(400).json({ error: 'invalid worry' });
    return;
  }
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    res.status(400).json({ error: 'image is required' });
    return;
  }

  try {
    const base64Data = imageBase64.includes(',')
      ? imageBase64.split(',')[1]
      : imageBase64;
    const inputBuffer = Buffer.from(base64Data, 'base64');

    if (inputBuffer.length > MAX_INPUT_BYTES) {
      res.status(413).json({ error: 'image too large' });
      return;
    }

    const resizedBuffer = await resizeForVision(inputBuffer);
    const resizedBase64 = resizedBuffer.toString('base64');

    const resultText = await readPalm(resizedBase64, worry);

    await pushMessage(userId, resultText);

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('liff-submit error:', err);
    res.status(500).json({ error: 'internal error' });
  }
};
