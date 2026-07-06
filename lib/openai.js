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

function buildSystemPrompt(worryLabel) {
  return `あなたはプロの手相占い師です。送られてきた手のひらの画像を見て、手相鑑定をしてください。

# 条件
- ユーザーが選んだ悩み「${worryLabel}」に寄せて助言する
- トーンは明るく前向きで、エンタメとして楽しめる範囲にする
- 「〜な傾向があります」のように断定しすぎない柔らかい言い回しにする
- 健康・寿命・病気の断定は一切しない
- 全体で300〜400字程度にまとめる
- 最後に、選んだ悩みへの小さな前向きなアドバイスを一言添える

# 画像が手相として読み取れない場合
手のひらが写っていない、手のひら全体が写っていない、不鮮明で線が判別できないなど、鑑定が難しい場合は、他の文章は一切書かず「手のひら全体が写った写真をもう一度送ってください」とだけ返してください。`;
}

async function readPalm(imageBase64, worryKey) {
  const worryLabel = WORRY_LABELS[worryKey] || WORRY_LABELS.other;

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: MAX_TOKENS,
    messages: [
      { role: 'system', content: buildSystemPrompt(worryLabel) },
      {
        role: 'user',
        content: [
          { type: 'text', text: `悩み: ${worryLabel}` },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
          },
        ],
      },
    ],
  });

  return response.choices[0].message.content.trim();
}

module.exports = { readPalm, WORRY_LABELS };
