import { verifySession, getCookie, COOKIE, json } from '../_lib/session'

/**
 * 커뮤니티 인기글 모니터(2026-08-31, 오너 지시).
 *
 * 목적: 20~30대가 지금 뭘 보고 있는지를 한 화면에서 보고 글 소재를 고르기 위한 것.
 * 각 사이트의 "공개된 인기글 목록"에서 제목·링크·반응수만 모아 온다. 본문은 가져오지
 * 않는다 — 소재 파악에 필요한 건 무엇이 화제인지이지 남의 글 전문이 아니다.
 *
 * 브라우저에서 직접 부르면 CORS 에 막히므로 서버(Pages Function)에서 대신 받아온다.
 * 관리자 세션이 있어야만 호출된다(로그인 안 한 사람에게 열어둘 이유가 없다).
 *
 * ⚠️ 사이트 HTML 구조는 언제든 바뀐다 — 한 곳이 깨져도 나머지는 나오도록 소스별로
 *    독립 처리하고, 실패한 소스는 error 로 표시만 하고 넘어간다.
 */
interface Env {
  SESSION_SECRET: string
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export interface TrendItem {
  source: string
  rank: number
  title: string
  url: string
  /** 조회수·댓글수 등 사이트가 노출하는 반응 지표(있는 것만) */
  views?: number
  comments?: number
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
    cf: { cacheTtl: 300, cacheEverything: true },
  } as RequestInit)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/** 네이트판 톡톡 랭킹 — 제목·조회수·댓글수가 목록에 다 있다. */
async function nate(): Promise<TrendItem[]> {
  const html = await fetchText('https://pann.nate.com/talk/ranking')
  const wrap = html.match(/<ul class="post_wrap">([\s\S]*?)<\/ul>/)
  if (!wrap) return []
  const items = wrap[1].match(/<li[\s\S]*?<\/li>/g) ?? []
  const out: TrendItem[] = []
  for (const li of items) {
    const href = li.match(/href="(\/talk\/\d+)"/)
    if (!href) continue
    const text = stripTags(li)
    // "1 제목 (댓글수) 미리보기… 조회 12,345 추천 6" 형태 → 앞의 순위·뒤의 지표를 떼어낸다
    const rank = Number(text.match(/^(\d+)\s/)?.[1] ?? out.length + 1)
    const title = (text.match(/^\d+\s+(.*?)\s*\(\d+\)/)?.[1] ?? text.slice(0, 80)).trim()
    const views = Number(text.match(/조회\s*([\d,]+)/)?.[1]?.replace(/,/g, '') ?? '') || undefined
    const comments = Number(text.match(/\((\d+)\)/)?.[1] ?? '') || undefined
    out.push({ source: '네이트판', rank, title, url: `https://pann.nate.com${href[1]}`, views, comments })
  }
  return out.slice(0, 30)
}

/**
 * 더쿠 핫게시판.
 * ⚠️ 목록 맨 위에 공지(class="notice")가 여러 줄 붙어 있다 — 이걸 안 걸러내면
 * "로그인 보안 강화" 같은 운영 공지가 1~5위를 차지한다(2026-08-31 실제로 그렇게 나왔다).
 * 조회수도 행 안의 숫자 중 최대값을 쓰면 공지의 수천만 조회가 섞여 엉터리가 된다 —
 * td.m_no(조회) / a.replyNum(댓글) 처럼 자리를 지정해서 읽는다.
 */
async function theqoo(): Promise<TrendItem[]> {
  const html = await fetchText('https://theqoo.net/hot')
  const rows = html.match(/<tr[\s\S]*?<\/tr>/g) ?? []
  const out: TrendItem[] = []
  for (const tr of rows) {
    const attrs = tr.match(/<tr([^>]*)>/)?.[1] ?? ''
    if (/notice/.test(attrs)) continue
    const a = tr.match(/<td class="title">[\s\S]*?<a href="(\/hot\/\d+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!a) continue
    const title = stripTags(a[2])
    if (!title) continue
    const cate = stripTags(tr.match(/<td class="cate">([\s\S]*?)<\/td>/)?.[1] ?? '')
    const views = Number(tr.match(/<td class="m_no">([\d,]+)<\/td>/)?.[1]?.replace(/,/g, '') ?? '') || undefined
    const comments = Number(tr.match(/class="replyNum">(\d+)</)?.[1] ?? '') || undefined
    out.push({
      source: '더쿠',
      rank: out.length + 1,
      title: cate ? `[${cate}] ${title}` : title,
      url: `https://theqoo.net${a[1]}`,
      views,
      comments,
    })
  }
  return out.slice(0, 30)
}

/** 클리앙 모두의공원. */
async function clien(): Promise<TrendItem[]> {
  const html = await fetchText('https://www.clien.net/service/board/park')
  const out: TrendItem[] = []
  const re = /href="(\/service\/board\/park\/\d+[^"#]*)"[^>]*>([\s\S]*?)<\/a>/g
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const title = stripTags(m[2])
    if (!title || title.length < 4 || seen.has(m[1])) continue
    seen.add(m[1])
    out.push({ source: '클리앙', rank: out.length + 1, title, url: `https://www.clien.net${m[1]}` })
  }
  return out.slice(0, 30)
}

const SOURCES: { key: string; run: () => Promise<TrendItem[]> }[] = [
  { key: '네이트판', run: nate },
  { key: '더쿠', run: theqoo },
  { key: '클리앙', run: clien },
]

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE)))) {
    return json({ error: 'unauthorized' }, 401)
  }
  const results = await Promise.all(
    SOURCES.map(async (s) => {
      try {
        return { source: s.key, items: await s.run(), error: null as string | null }
      } catch (e: any) {
        // 한 곳이 막히거나 구조가 바뀌어도 나머지는 보여준다.
        return { source: s.key, items: [] as TrendItem[], error: String(e?.message ?? e).slice(0, 120) }
      }
    }),
  )
  return json({ fetchedAt: new Date().toISOString(), results })
}
