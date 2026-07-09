// 이미지(포스터)에서 참가 나이(년생)를 추출하는 OCR 워커. Cloudflare Workers AI(Neurons) 사용.
// 크롤러가 GET /?img=<이미지URL>[&secret=...] 로 호출 → {male, female, raw} 반환.

const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

const PROMPT = `이 한국 소개팅/파티 포스터 이미지에서 참가 가능 나이(출생연도)를 찾아라.
보통 '남성: 90 ~ 00년생 / 여성: 92 ~ 02년생' 또는 '남성,여성: 88 ~ 02년생' 형태로 하단에 적혀 있다.
그 문구를 있는 그대로, 다른 말 없이 한 줄로만 출력해라. 없으면 NONE 만 출력.`;

function parseAge(raw) {
  const t = (raw || '').replace(/\s+/g, '');
  const out = {};
  const both = t.match(/남[성자],?여[성자][:\-]?(\d{2})[~\-∼ー](\d{2})/);
  if (both) { out.male = `${both[1]}~${both[2]}년생`; out.female = `${both[1]}~${both[2]}년생`; }
  const m = t.match(/남[성자][:\-]?(\d{2})[~\-∼ー](\d{2})/);
  const f = t.match(/여[성자][:\-]?(\d{2})[~\-∼ー](\d{2})/);
  if (m) out.male = `${m[1]}~${m[2]}년생`;
  if (f) out.female = `${f[1]}~${f[2]}년생`;
  return out;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const img = url.searchParams.get('img');
    if (!img) return Response.json({ error: 'missing img' }, { status: 400 });
    // 선택적 공유 시크릿(설정돼 있으면 검사)
    if (env.OCR_SECRET && url.searchParams.get('secret') !== env.OCR_SECRET) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    const force = url.searchParams.get('force') === '1';
    // 캐시 조회(이미지 URL 키) — 새 이미지가 아니면 AI 재실행 안 함
    if (env.CACHE && !force) {
      const hit = await env.CACHE.get(img);
      if (hit) return Response.json({ ...JSON.parse(hit), cached: true });
    }
    try {
      // imweb 등 CDN이 봇 fetch(UA/Referer 없음)를 403 차단 → 브라우저 헤더로 우회
      const r = await fetch(img, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Referer': 'https://www.modparty.co.kr/',
          'Accept': 'image/avif,image/webp,image/png,image/*,*/*',
        },
      });
      if (!r.ok) return Response.json({ error: `fetch ${r.status}` }, { status: 502 });
      const bytes = [...new Uint8Array(await r.arrayBuffer())];
      const ai = await env.AI.run(VISION_MODEL, { image: bytes, prompt: PROMPT, max_tokens: 128 });
      const raw = (ai && (ai.response ?? ai.description ?? '')).toString().trim();
      const result = { raw, ...parseAge(raw) };
      // 나이를 실제로 뽑았을 때만 캐시(빈 결과는 다음에 재시도)
      if (env.CACHE && (result.male || result.female)) {
        await env.CACHE.put(img, JSON.stringify(result));
      }
      return Response.json({ ...result, cached: false });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  },
};
