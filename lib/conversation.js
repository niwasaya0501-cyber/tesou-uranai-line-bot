const { Redis } = require('@upstash/redis');

// Vercel MarketplaceからUpstash Redisを接続すると、KV_REST_API_URL / KV_REST_API_TOKEN
// という名前で環境変数が自動追加される（UPSTASH_REDIS_REST_URL等ではない点に注意）
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// ラリーは同日中の続きを想定し、24時間で自然に消えるようにする
// （無料枠のストレージ容量を圧迫しないための保険でもある）
const TTL_SECONDS = 60 * 60 * 24;

// 1鑑定あたりの往復上限。これを超えたコストの際限ない積み上がりを防ぐ
const MAX_TURNS = 10;

function sessionKey(sessionId) {
  return `session:${sessionId}`;
}

async function getSession(sessionId) {
  const raw = await redis.get(sessionKey(sessionId));
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function saveSession(sessionId, session) {
  await redis.set(sessionKey(sessionId), JSON.stringify(session), { ex: TTL_SECONDS });
}

async function deleteSession(sessionId) {
  await redis.del(sessionKey(sessionId));
}

module.exports = { getSession, saveSession, deleteSession, MAX_TURNS };
