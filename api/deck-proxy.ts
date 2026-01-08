import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // 取 ? 后面的参数
  const query = req.url?.split('?')[1] ?? '';

  // 目标 HTTP 地址
  const targetUrl = `http://deck.ourygo.top/?${query}`;

  try {
    const r = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    });

    let html = await r.text();

    // ⭐ 核心修复：修正 HTML 中的相对资源路径
    html = html.replace(
      /(src|href)="\/([^"]+)"/g,
      '$1="http://deck.ourygo.top/$2"'
    );

    // 返回 HTML（HTTPS）
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(r.status).send(html);
  } catch (e: any) {
  console.error('deck-proxy error:', e);
  res.status(500).send(e?.message || 'deck proxy error');
  }
}
