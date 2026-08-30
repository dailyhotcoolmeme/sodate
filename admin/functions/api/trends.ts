import { verifySession, getCookie, COOKIE, json } from '../_lib/session'

/**
 * 커뮤니티 인기글 모니터(2026-08-31, 오너 지시).
 *
 * 목적: 20~30대가 지금 뭘 보고 있는지를 한 화면에서 보고 글 소재를 고르기 위한 것.
 * 각 사이트의 "공개된 인기글 목록"에서 제목·링크·작성시각·반응수만 모아 온다.
 *
 * ⚠️ 반응 지표는 사이트마다 이름이 다르다(추천 / 공감 / 조회 …). 오너 지시로
 *    **각 사이트가 쓰는 용어를 그대로** 보여준다 — 억지로 '좋아요' 같은 공통 이름으로
 *    바꾸지 않는다. 그래서 metrics 를 {label, value} 배열로 두고 파서가 그 사이트의
 *    표기를 그대로 채운다.
 *
 * 브라우저에서 직접 부르면 CORS 에 막히므로 서버(Pages Function)에서 대신 받아온다.
 * 관리자 세션이 있어야만 호출된다.
 *
 * ⚠️ 사이트 HTML 구조는 언제든 바뀐다 — 한 곳이 깨져도 나머지는 나오도록 소스별로
 *    독립 처리하고, 실패한 소스는 error 로 표시만 하고 넘어간다.
 */
interface Env {
  SESSION_SECRET: string
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export interface Metric {
  /** 그 사이트가 쓰는 이름 그대로(조회 / 추천 / 공감 / 댓글 …) */
  label: string
  value: string
}

export interface TrendItem {
  source: string
  rank: number
  title: string
  url: string
  /** 목록에 표기된 작성 시각. 사이트마다 형식이 달라 문자열 그대로 둔다(없으면 생략). */
  postedAt?: string
  metrics: Metric[]
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

/** 값이 있는 지표만 담는다(0도 유효한 값이라 빈 문자열만 걸러낸다). */
function metric(list: Metric[], label: string, value: string | undefined | null) {
  const v = (value ?? '').trim()
  if (v) list.push({ label, value: v })
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
    cf: { cacheTtl: 300, cacheEverything: true },
  } as RequestInit)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/** 네이트판은 목록에 시각이 없어 글 페이지에서 하나씩 읽어온다(실패하면 그냥 비운다). */
async function nateDate(url: string): Promise<string | undefined> {
  try {
    const html = await fetchText(url)
    return html.match(/<span class="date">([^<]+)<\/span>/)?.[1]?.trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * 네이트판 톡톡 랭킹.
 * 지표 표기: "조회 17,436", "추천 58", 제목 옆 "(98)" = 댓글수.
 *
 * ⚠️ 랭킹 목록에는 작성 시각이 없다 — 오너가 "날짜시간 붙여라"(2026-08-31) 라고 해서
 *    글 페이지를 따로 열어 <span class="date"> 를 읽어 붙인다. 20개 병렬로 0.4초쯤 걸린다.
 *    개수를 늘리면 Workers 의 요청당 서브요청 한도(50)에 걸리니 NATE_LIMIT 은 그대로 둘 것.
 */
const NATE_LIMIT = 20

async function nate(): Promise<TrendItem[]> {
  const html = await fetchText('https://pann.nate.com/talk/ranking')
  const wrap = html.match(/<ul class="post_wrap">([\s\S]*?)<\/ul>/)
  if (!wrap) return []
  const items = wrap[1].match(/<li[\s\S]*?<\/li>/g) ?? []
  const out: TrendItem[] = []
  for (const li of items) {
    const href = li.match(/href="(\/talk\/\d+)"/)
    if (!href) continue
    const title = decodeEntities(li.match(/<h2><a[^>]*title="([^"]*)"/)?.[1] ?? '').trim()
      || stripTags(li.match(/<h2>([\s\S]*?)<\/h2>/)?.[1] ?? '')
    if (!title) continue
    const metrics: Metric[] = []
    metric(metrics, '조회', li.match(/class="count">\s*조회\s*([\d,]+)/)?.[1])
    metric(metrics, '추천', li.match(/class="rcm">\s*추천\s*([\d,]+)/)?.[1])
    metric(metrics, '댓글', li.match(/class="reple-num">\((\d+)\)/)?.[1])
    out.push({
      source: '네이트판',
      rank: out.length + 1,
      title,
      url: `https://pann.nate.com${href[1]}`,
      metrics,
    })
    if (out.length >= NATE_LIMIT) break
  }
  const dates = await Promise.all(out.map((i) => nateDate(i.url)))
  return out.map((i, idx) => ({ ...i, postedAt: dates[idx] }))
}

/**
 * 더쿠 핫게시판.
 * ⚠️ 목록 맨 위에 공지(class="notice")가 여러 줄 붙어 있다 — 안 걸러내면 운영 공지가
 *    1~5위를 차지한다(2026-08-31 실제로 그렇게 나왔다). 조회수도 행 안 숫자 중 최대값을
 *    쓰면 공지의 수천만 조회가 섞이므로 td.m_no / a.replyNum 처럼 자리를 지정해 읽는다.
 * 지표 표기: 조회(td.m_no), 댓글(a.replyNum). 추천 표시는 목록에 없다.
 * 시각은 td.time — 당일 글은 "00:27", 지난 글은 "08.30" 형태.
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
    const metrics: Metric[] = []
    metric(metrics, '조회', tr.match(/<td class="m_no">([\d,]+)<\/td>/)?.[1])
    metric(metrics, '댓글', tr.match(/class="replyNum">(\d+)</)?.[1])
    out.push({
      source: '더쿠',
      rank: out.length + 1,
      title: cate ? `[${cate}] ${title}` : title,
      url: `https://theqoo.net${a[1]}`,
      postedAt: stripTags(tr.match(/<td class="time">([\s\S]*?)<\/td>/)?.[1] ?? '') || undefined,
      metrics,
    })
  }
  return out.slice(0, 30)
}

/**
 * 클리앙 모두의공원.
 * 지표 표기: 클리앙은 추천을 "공감"이라 부른다(list-like-count). 조회는 list_hit,
 * 댓글수는 행 속성 data-comment-count 에 들어 있다.
 * 시각은 .timestamp 에 "2026-08-31 01:10:46" 전체가 들어 있어 그걸 쓴다.
 */
async function clien(): Promise<TrendItem[]> {
  const html = await fetchText('https://www.clien.net/service/board/park')
  const chunks = html.split('<div class="list_item')
  const out: TrendItem[] = []
  for (const raw of chunks.slice(1)) {
    if (/^\s*[^>]*notice/.test(raw)) continue
    const a = raw.match(/href="(\/service\/board\/park\/\d+[^"#]*)"/)
    const title = decodeEntities(
      raw.match(/data-role="list-title-text"[^>]*title="([^"]*)"/)?.[1] ?? '',
    ).trim()
    if (!a || !title) continue
    const metrics: Metric[] = []
    metric(metrics, '조회', stripTags(raw.match(/class="hit">([\s\S]*?)<\/span>/)?.[1] ?? ''))
    metric(metrics, '공감', stripTags(raw.match(/data-role="list-like-count"><span>([\s\S]*?)<\/span>/)?.[1] ?? ''))
    metric(metrics, '댓글', raw.match(/data-comment-count=(\d+)/)?.[1])
    out.push({
      source: '클리앙',
      rank: out.length + 1,
      title,
      url: `https://www.clien.net${a[1]}`,
      postedAt: raw.match(/class="timestamp">([\s\S]*?)<\/span>/)?.[1]?.trim() || undefined,
      metrics,
    })
  }
  return out.slice(0, 30)
}

/**
 * 디시인사이드 실시간베스트.
 * 지표 표기: 조회(td.gall_count), 추천(td.gall_recommend), 댓글(span.reply_num "[59/2]" 앞자리).
 * 시각은 td.gall_date 의 title 속성에 "2026-08-31 01:25:01" 전체가 들어 있다.
 * ⚠️ 맨 위 설문·공지 행은 글번호 칸이 숫자가 아니다 — 그걸로 걸러낸다.
 */
async function dcinside(): Promise<TrendItem[]> {
  const html = await fetchText('https://gall.dcinside.com/board/lists/?id=dcbest')
  const rows = html.match(/<tr class="ub-content[\s\S]*?<\/tr>/g) ?? []
  const out: TrendItem[] = []
  for (const tr of rows) {
    const num = stripTags(tr.match(/<td class="gall_num">([\s\S]*?)<\/td>/)?.[1] ?? '')
    if (!/^\d+$/.test(num)) continue
    const cell = tr.match(/<td class="gall_tit[^"]*">([\s\S]*?)<\/td>/)?.[1]
    const href = cell?.match(/href="(\/board\/view\/\?[^"]+)"/)
    if (!cell || !href) continue
    // 댓글수 링크와 썸네일은 제목 글자에 섞이므로 먼저 걷어낸다.
    const title = stripTags(
      cell.replace(/<a class="reply_numbox"[\s\S]*?<\/a>/g, '').replace(/<div class="thumimg">[\s\S]*?<\/div>/g, ''),
    )
    if (!title) continue
    const metrics: Metric[] = []
    metric(metrics, '조회', stripTags(tr.match(/<td class="gall_count">([\s\S]*?)<\/td>/)?.[1] ?? '').replace('-', ''))
    metric(metrics, '추천', stripTags(tr.match(/<td class="gall_recommend">([\s\S]*?)<\/td>/)?.[1] ?? '').replace('-', ''))
    metric(metrics, '댓글', cell.match(/class="reply_num">\[(\d+)/)?.[1])
    out.push({
      source: '디시 실베',
      rank: out.length + 1,
      title,
      url: `https://gall.dcinside.com${decodeEntities(href[1])}`,
      postedAt:
        tr.match(/<td class="gall_date"[^>]*title="([^"]+)"/)?.[1] ||
        stripTags(tr.match(/<td class="gall_date"[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? '') ||
        undefined,
      metrics,
    })
  }
  return out.slice(0, 30)
}

/**
 * 루리웹 유머 베스트.
 * 지표 표기: 조회(td.hit), 추천(td.recomd), 댓글(span.num_reply "(75)").
 * 시각은 td.time — 당일이면 "22:51".
 * ⚠️ 맨 위 고정 3줄만 제목이 <strong>, 나머지는 <span> 이다(둘 다 class="text_over").
 *    한쪽만 받으면 3건밖에 안 잡힌다.
 */
async function ruliweb(): Promise<TrendItem[]> {
  const html = await fetchText('https://bbs.ruliweb.com/best/humor_only/now')
  const out: TrendItem[] = []
  for (const tr of html.split('<tr class="table_body').slice(1)) {
    const a = tr.match(/href="(?:https?:\/\/bbs\.ruliweb\.com)?(\/best\/board\/\d+\/read\/\d+[^"]*)"/)
    const title = stripTags(tr.match(/<(?:strong|span) class="text_over">([\s\S]*?)<\/(?:strong|span)>/)?.[1] ?? '')
    if (!a || !title) continue
    const metrics: Metric[] = []
    metric(metrics, '조회', stripTags(tr.match(/<td class="hit">([\s\S]*?)<\/td>/)?.[1] ?? ''))
    metric(metrics, '추천', stripTags(tr.match(/<td class="recomd">([\s\S]*?)<\/td>/)?.[1] ?? ''))
    metric(metrics, '댓글', tr.match(/class="num_reply[^"]*">\s*\((\d+)\)/)?.[1])
    out.push({
      source: '루리웹',
      rank: out.length + 1,
      title,
      url: `https://bbs.ruliweb.com${decodeEntities(a[1])}`,
      postedAt: stripTags(tr.match(/<td class="time">([\s\S]*?)<\/td>/)?.[1] ?? '') || undefined,
      metrics,
    })
  }
  return out.slice(0, 30)
}

const SOURCES: { key: string; run: () => Promise<TrendItem[]> }[] = [
  { key: '네이트판', run: nate },
  { key: '더쿠', run: theqoo },
  { key: '클리앙', run: clien },
  { key: '디시 실베', run: dcinside },
  { key: '루리웹', run: ruliweb },
]

/**
 * 제목에 "후방"(후방주의 = 수위 있는 글)이 붙은 글은 목록에서 뺀다(오너 지시 2026-08-31).
 * 사이트마다 [후방] · 후방주의 · 후방ㅈㅇ 등 표기가 달라 글자만 보고 거른다.
 */
function isBlockedTitle(title: string): boolean {
  return title.includes('후방')
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE)))) {
    return json({ error: 'unauthorized' }, 401)
  }
  const results = await Promise.all(
    SOURCES.map(async (s) => {
      try {
        // 거른 뒤에 순위를 다시 매긴다 — 중간이 빠져 1,3,4 로 튀지 않게.
        const items = (await s.run())
          .filter((i) => !isBlockedTitle(i.title))
          .map((i, idx) => ({ ...i, rank: idx + 1 }))
        return { source: s.key, items, error: null as string | null }
      } catch (e: any) {
        // 한 곳이 막히거나 구조가 바뀌어도 나머지는 보여준다.
        return { source: s.key, items: [] as TrendItem[], error: String(e?.message ?? e).slice(0, 120) }
      }
    }),
  )
  return json({ fetchedAt: new Date().toISOString(), results })
}
