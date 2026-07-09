const { resizeForVision } = require('../lib/image');
const { readPalm, WORRY_LABELS, getFollowUpExample } = require('../lib/openai');
const { saveSession } = require('../lib/conversation');
const { getClientIp, checkRateLimit } = require('../lib/rateLimit');

// 手前でクライアント側リサイズ済みだが、念のため異常に大きいリクエストは弾く
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 2;
const MAX_WORRY_TEXT_LENGTH = 100;

// LINEの友だち登録という参入障壁がなくなるため、IP単位で1日あたりの
// 鑑定回数（＝画像を使うOpenAI呼び出し）に上限を設け、費用の際限ない増加を防ぐ
const DAILY_LIMIT_PER_IP = 15;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60 * 24;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const { sessionId, worry, images } = req.body || {};
  let { worryText } = req.body || {};

  if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 100) {
    res.status(400).json({ error: 'invalid sessionId' });
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
    const ip = getClientIp(req);
    const withinLimit = await checkRateLimit(
      `ratelimit:submit:${ip}`,
      DAILY_LIMIT_PER_IP,
      RATE_LIMIT_WINDOW_SECONDS
    );
    if (!withinLimit) {
      res.status(429).json({ error: '本日の鑑定回数の上限に達しました。また明日お試しください。' });
      return;
    }
  } catch (err) {
    // レート制限のチェック自体が失敗しても、鑑定機能全体を止めない
    console.error('rate limit check error:', err);
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
      `submit: images=${resizedBuffers.length}, sizes=${resizedBuffers
        .map((b) => `${b.length}bytes`)
        .join(',')}, worry=${worry}`
    );

    const result = await readPalm(resizedBase64Images, worry, worryText);

    if (!result.readable) {
      res.status(200).json({ ok: true, unreadable: true });
      return;
    }

    // この後ページ上のチャットで続けて質問できるようセッションを保存する。
    // ここが失敗しても鑑定結果自体はレスポンスで返せるので、成功のままにする
    try {
      await saveSession(sessionId, {
        worry,
        worryText,
        readingText: result.text,
        turns: [],
        turnCount: 0,
      });
    } catch (sessionErr) {
      console.error('saveSession error:', sessionErr);
    }

    res.status(200).json({
      ok: true,
      unreadable: false,
      reading: result.text,
      followUpExample: getFollowUpExample(worry, worryText),
    });
  } catch (err) {
    console.error('submit error:', err);
    res.status(500).json({ error: 'internal error' });
  }
};
