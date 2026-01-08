import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // 取 ? 后面的参数
  const query = req.url?.split('?')[1] ?? '';

  // 拼目标 HTTP 地址
  const targetUrl = `http://deck.ourygo.top/?${query}`;

  try {
    const r = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    });

    const html = await r.text();

    // 返回 HTML（HTTPS）
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(r.status).send(html);
  } catch (e) {
    res.status(500).send('deck proxy error');
  }
}
