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
