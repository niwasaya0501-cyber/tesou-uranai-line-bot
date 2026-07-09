const { deleteSession } = require('../lib/conversation');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const { sessionId } = req.body || {};

  if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 100) {
    res.status(400).json({ error: 'invalid sessionId' });
    return;
  }

  try {
    await deleteSession(sessionId);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('deleteSession error:', err);
    res.status(500).json({ error: 'internal error' });
  }
};
