const ALLOWED_OUTLINK_DOMAINS = [
  'lovematching.kr',
  'lovematching.co.kr',
  'yeonin.co.kr',
  'emotional0ranges.com',
  'emotionorange.com',
  'frip.co.kr',
  'munto.kr',
  'modparty.co.kr',
  'lovecasting.co.kr',
  'solo-off.com',
  'solooff.com',
  'talkblossom.co.kr',
  'somoim.co.kr',
  'booking.naver.com',
  'toss.im',
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
