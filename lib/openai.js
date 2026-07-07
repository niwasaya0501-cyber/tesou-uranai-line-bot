const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const WORRY_LABELS = {
  love: '恋愛',
  work: '仕事',
  relationship: '人間関係',
  self: '自己分析',
  other: 'その他',
};

const MAX_TOKENS = 700;

// プロンプトで指示していても、モデルがMarkdown記法(**太字**や見出しの#等)を
// 出力してしまうことがあるため、LINEのプレーンテキストに送る前に念のため除去する
function stripMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^[*-]\s+/gm, '・');
}

// 「その他」が選ばれ、自由入力のテキストがある場合はそちらを悩みの表示名として使う
function resolveWorryLabel(worryKey, worryText) {
  if (worryKey === 'other' && worryText) return worryText;
  return WORRY_LABELS[worryKey] || WORRY_LABELS.other;
}

// 鑑定後の「続けて質問できます」案内で示す例文。選んだ悩みとズレた例
// （仕事の鑑定なのに恋愛の例を出す、等）にならないよう、悩みごとに変える
const FOLLOW_UP_EXAMPLES = {
  love: '今年の恋愛運は？',
  work: '今年の仕事運は？',
  relationship: '人間関係で気をつけることは？',
  self: '私の強みは？',
};

function buildFollowUpInvite(worryKey, worryText) {
  const example =
    worryKey === 'other' && worryText
      ? `${worryText}についてもっと詳しく教えて`
      : FOLLOW_UP_EXAMPLES[worryKey] || '今年の運勢は？';

  return `気になることがあれば、このトークにそのまま質問してみてくださいね（例：「${example}」など）。`;
}

function buildSystemPrompt(worryLabel) {
  return `あなたはプロの手相占い師です。送られてきた手のひらの画像を見て、手相鑑定をしてください。

# 条件
- ユーザーが選んだ悩み「${worryLabel}」に寄せて助言する
- トーンは明るく前向きで、エンタメとして楽しめる範囲にする
- 「〜な傾向があります」のように断定しすぎない柔らかい言い回しにする
- 健康・寿命・病気の断定は一切しない
- 全体で300〜400字程度にまとめる
- 最後に、選んだ悩みへの小さな前向きなアドバイスを一言添える

# 画像の枚数について
- 画像が1枚の場合：その片手の手相から鑑定してください
- 画像が2枚の場合：両手（利き手と反対の手）の手相とみなし、2枚の情報を総合して1つの鑑定にまとめてください。「1枚目と2枚目で〜」のような画像枚数への言及はせず、自然な1つの鑑定文にしてください

# このBotはエンタメ目的です
多少ピントが甘い・角度が斜め・影がある程度では拒否しないでください。手のひららしきものが写っていれば、見える範囲の線から前向きな鑑定を組み立ててください。

# 読み取れない場合
すべての画像において、手が全く写っていない、手のひらではなく手の甲や指先だけが写っている、あるいは手とは全く関係のない画像である場合に限り、読み取れなかったものとして扱ってください。

# 出力形式について（JSON）
他の文章は一切含めず、必ず次のJSON形式のみで出力してください。
- 通常に鑑定できた場合: {"readable": true, "reading": "鑑定文をここに入れる"}
- 読み取れなかった場合: {"readable": false, "reading": ""}
"reading"の中身はLINEのトーク画面にそのまま送られるプレーンテキストです。**太字**や見出し（#）、箇条書きの記号（*, -）などのMarkdown記法は使わず、装飾のない文章だけで書いてください。`;
}

async function readPalm(imagesBase64, worryKey, worryText) {
  const worryLabel = resolveWorryLabel(worryKey, worryText);

  const imageContents = imagesBase64.map((imageBase64) => ({
    type: 'image_url',
    image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' },
  }));

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: MAX_TOKENS,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildSystemPrompt(worryLabel) },
      {
        role: 'user',
        content: [
          { type: 'text', text: `悩み: ${worryLabel}（画像枚数: ${imagesBase64.length}枚）` },
          ...imageContents,
        ],
      },
    ],
  });

  const parsed = JSON.parse(response.choices[0].message.content);
  if (!parsed.readable) {
    return { readable: false };
  }

  return { readable: true, text: stripMarkdown(String(parsed.reading).trim()) };
}

// ラリー用の返答は短めに抑え、コストを低く保つ
const CHAT_MAX_TOKENS = 400;

function buildChatSystemPrompt(readingText, worryLabel) {
  return `あなたは明るく前向きな手相占い師です。以下は、さきほどこのユーザーに伝えた手相鑑定の結果です。

# 直前の鑑定結果
${readingText}

# 会話の続け方
- ユーザーからの追加の質問や相談に、上記の鑑定を踏まえて答える
- 悩み「${worryLabel}」に寄り添った、明るく前向きなトーンを保つ
- 「〜な傾向があります」のように断定しすぎない柔らかい言い回しにする
- 健康・寿命・病気の断定は一切しない
- 1回の返答は150〜250字程度で簡潔にまとめる

# 出力形式について
これはLINEのトーク画面にそのまま送られるプレーンテキストです。**太字**や見出し（#）、箇条書きの記号（*, -）などのMarkdown記法は使わず、装飾のない文章だけで書いてください。`;
}

// 会話の続き（テキストのみ）。画像は再送しないため、鑑定時より大幅に低コストで済む
async function continueChat({ readingText, worry, worryText, turns, userMessage }) {
  const worryLabel = resolveWorryLabel(worry, worryText);

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: CHAT_MAX_TOKENS,
    messages: [
      { role: 'system', content: buildChatSystemPrompt(readingText, worryLabel) },
      ...turns,
      { role: 'user', content: userMessage },
    ],
  });

  return stripMarkdown(response.choices[0].message.content.trim());
}

module.exports = { readPalm, continueChat, WORRY_LABELS, buildFollowUpInvite };
