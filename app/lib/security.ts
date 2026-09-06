const ALLOWED_OUTLINK_DOMAINS = [
  'yeonin.co.kr',
  'emotional0ranges.com',
  'emotionorange.com',
  'frip.co.kr',
  'munto.kr',
  'modparty.co.kr',
  'lovecasting.co.kr',
  'talkblossom.co.kr',
  'yeongyul.com',
  'inssumparty.co.kr',
  '2yeonsi.com',
  'seolrem1.com',
  'secretsalon.co.kr',
  'flipo.co.kr',
  'lovecommunity.imweb.me',
  'imweb.me',
  'somoim.co.kr',
  'booking.naver.com',
  'toss.im',
  // 후기 링크
  'instagram.com',
  'blog.naver.com',
  'naver.com',
  'youtube.com',
  'youtu.be',
  // 인스타 전용 업체(자체 사이트 없음, 2026-08-11) — 신청 링크가 구글폼인 유니브리지소셜용
  'docs.google.com',
  'forms.gle',
  // 우리 소개 사이트 — MY의 '제휴문의'가 moitbiz.com/partner 로 나간다(2026-09-06).
  // 여기 없으면 openOutlink 가 막아서 눌러도 조용히 안 열린다.
  'moitbiz.com',
]

export function isAllowedOutlink(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return false
    const hostname = parsed.hostname.replace(/^www\./, '')
    return ALLOWED_OUTLINK_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`))
  } catch {
    return false
  }
}
