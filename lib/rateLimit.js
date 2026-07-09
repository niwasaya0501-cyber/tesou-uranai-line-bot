const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// LINE経由をやめてURLを直接公開する構成では、LINEの友だち登録という
// 自然な参入障壁がなくなるため、IPアドレス単位の簡易レート制限でOpenAI費用の
// 際限ない増加を防ぐ（画像を使う鑑定と、テキストのみのラリーで別々に上限を設ける）
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// keyの回数をインクリメントし、初回のみTTLを設定する。
// 戻り値は「上限以内かどうか」
async function checkRateLimit(key, limit, windowSeconds) {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return count <= limit;
}

module.exports = { getClientIp, checkRateLimit };
