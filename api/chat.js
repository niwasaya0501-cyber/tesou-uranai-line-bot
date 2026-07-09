const { continueChat } = require('../lib/openai');
const { getSession, saveSession, MAX_TURNS } = require('../lib/conversation');
const { getClientIp, checkRateLimit } = require('../lib/rateLimit');

const MAX_MESSAGE_LENGTH = 300;

// ラリーはテキストのみで画像より低コストだが、無制限に呼ばれ続けないよう
// IP単位で緩めの1日上限を設ける（1セッションあたりの上限は別途MAX_TURNSで管理）
const DAILY_LIMIT_PER_IP = 100;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60 * 24;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const { sessionId, message } = req.body || {};

  if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 100) {
    res.status(400).json({ error: 'invalid sessionId' });
    return;
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'message is required' });
    return;
  }
  const userMessage = message.trim().slice(0, MAX_MESSAGE_LENGTH);

  try {
    const ip = getClientIp(req);
    const withinLimit = await checkRateLimit(
      `ratelimit:chat:${ip}`,
      DAILY_LIMIT_PER_IP,
      RATE_LIMIT_WINDOW_SECONDS
    );
    if (!withinLimit) {
      res.status(429).json({ error: '本日の利用上限に達しました。また明日お試しください。' });
      return;
    }
  } catch (err) {
    console.error('rate limit check error:', err);
  }

  let session;
  try {
    session = await getSession(sessionId);
  } catch (err) {
    console.error('getSession error:', err);
    res.status(500).json({ error: 'internal error' });
    return;
  }

  if (!session) {
    res.status(404).json({ error: 'no active session' });
    return;
  }

  if (session.turnCount >= MAX_TURNS) {
    res.status(200).json({ ok: true, limitReached: true, reply: null });
    return;
  }

  let replyText;
  try {
    replyText = await continueChat({
      readingText: session.readingText,
      worry: session.worry,
      worryText: session.worryText,
      turns: session.turns,
      userMessage,
    });
  } catch (err) {
    console.error('continueChat error:', err);
    res.status(500).json({ error: 'chat failed' });
    return;
  }

  const newTurnCount = session.turnCount + 1;

  // 保存が失敗しても、既に生成できた返信は届ける(次回以降の文脈は引き継げないだけにする)
  try {
    await saveSession(sessionId, {
      ...session,
      turns: [
        ...session.turns,
        { role: 'user', content: userMessage },
        { role: 'assistant', content: replyText },
      ],
      turnCount: newTurnCount,
    });
  } catch (err) {
    console.error('saveSession error:', err);
  }

  res.status(200).json({
    ok: true,
    reply: replyText,
    turnCount: newTurnCount,
    limitReached: newTurnCount >= MAX_TURNS,
  });
};
