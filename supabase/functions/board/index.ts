import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'

// 미디어는 전부 R2(이그레스 무료). 게시판 이미지도 R2 로 업로드한다(공개 서빙=sodate-admin.pages.dev/media/{key}).
const r2 = new AwsClient({
  accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') ?? '',
  secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '',
  region: 'auto', service: 's3',
})
async function r2Put(key: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const endpoint = (Deno.env.get('R2_ENDPOINT') ?? '').replace(/\/$/, '')
  const bucket = Deno.env.get('R2_BUCKET') ?? ''
  const res = await r2.fetch(`${endpoint}/${bucket}/${key}`, {
    method: 'PUT', body: bytes, headers: { 'Content-Type': contentType },
  })
  if (!res.ok) throw new Error(`R2 upload ${res.status}`)
  return `${Deno.env.get('R2_PUBLIC_BASE')}/media/${key}`
}

// 게시판(docs/BOARD_SPEC.md) — 글·댓글 작성/수정/삭제, 추천·비추, 신고.
// 로그인 없음 → 익명 기기 시크릿(ownerToken)의 해시로 소유권을 확인한다(후기와 동일).
// 조회는 앱이 RLS로 직접 읽으므로 여기서는 쓰기만 다룬다.

// ── 금칙어 ───────────────────────────────────────────────────────────────
// 후기용 목록을 그대로 쓰면 익명 자유게시판에는 약하다. 두 가지가 빠져 있었다.
//   1) 초성·변형 — 'ㅅㅂ', '시1발', 'ㅄ' 을 못 잡는다
//   2) 홍보 글 — 오픈채팅 링크·전화번호를 전혀 못 막는다
// 그래서 정규화 단계를 두고, 게시판용 목록과 패턴을 더했다.

// 2026-08-12 오너 지시로 대폭 완화. 신고 기능이 별도로 있으니 자동필터는 확실한
// 것만 걸러내고, 애매한 건 사람(신고)이 판단하게 한다. 네 갈래로 정리:
//   1) '보지'/'자지'는 삭제 — "안 보지", "잘 자지 못했어"처럼 흔한 동사 활용형과 겹침.
//   2) '19금'·'av배우'는 삭제 — 숫자·영문 제거 로직 때문에 '금'·'배우' 한 글자로
//      줄어들어 "궁금하네요"(2026-08-12 실제 신고), "지금", "저 배우" 등을 걸렀다.
//      숫자·영문이 섞인 금칙어는 전부 이 함정이 있으니 새로 추가할 때 주의.
//   3) '시발'·'새끼'·'걸레'·'죽어라'·'뒤져라'는 삭제 — 진짜 욕이기도 하지만
//      "시발역"(지하철 용어), "새끼손가락", "걸레질"(청소), "죽어라 준비했는데"(관용구),
//      "서랍 뒤져라"(뒤지다=찾다)처럼 정상 문장에도 흔해서 오탐이 잦았다(오너 지적
//      2026-08-12: "뒤져라는 욕설 아니다"). '개새끼'(복합어라 오탐 적음)는 남겨
//      최소한의 보호는 유지. 나머지는 신고로 대응.
//   3-1) '씨발'(가장 흔한 철자)도 삭제 — "OO 씨 발표/발언/발음"처럼 이름·직함 뒤
//      존칭 "씨"에 "발-"로 시작하는 흔한 단어(발표·발언·발생·발전 등)가 붙으면
//      공백 제거 후 그대로 "씨발"이 됐다. 오탐이 너무 잦아 오너 확인 후 삭제
//      (2026-08-12: "모두 완화시켜"). '씨빨'과 초성 'ㅅㅂ'/'ㅆㅂ'는 남겨둠.
//   4) 성적 대상화 노골적 표현·성매매 유도·혐오 발언·자해 협박은 그대로 둔다 —
//      이건 애플 1.2(UGC 모더레이션) 요건과도 직결된다.
const BAD_WORDS = [
  // 후기와 공통
  '씨빨', '개새끼', '지랄', '좆',
  '엠창', '느금', '창녀', '창놈', '미친년', '미친놈', '썅',
  'fuck', 'shit', 'bitch', 'asshole', 'porn',
  // 게시판 보강 — 욕설·비하
  '개놈', '썅년', '썅놈', '쌍놈', '쌍년', '호로자식',
  // '한녀'는 "성한 녀석"류에, '틀니'는 그냥 의료용어(원래 노린 욕은 '틀딱'이 이미
  // 잡음)라 둘 다 삭제(2026-08-12).
  '한남충', '김치녀', '된장녀', '맘충', '급식충', '틀딱',
  '정신병자',
  // 성적 표현(노골적 성매매·불법 촬영물 유도만 — 대화 맥락에서 나올 수 있는 '섹스'는 뺐다)
  '야동', '조건만남', '출장안마', '성매매', '유흥알바',
  '가슴사진', '몸매사진', '노출사진', '섹파', '원나잇',
]

// 초성만 쓴 욕설. 'ㅗ' 단독은 자모 하나라 오탐이 너무 잦아 뺐다(2026-08-12).
const CHOSUNG_WORDS = ['ㅅㅂ', 'ㅆㅂ', 'ㅄ', 'ㅂㅅ', 'ㅁㅊ', 'ㅈㄹ', 'ㄷㅊ', 'ㅈㄴ']

/**
 * 띄어쓰기를 지우지 않은 원문에서만 찾는 금칙어(2026-08-13 감사).
 *
 * 위 BAD_WORDS 는 공백·숫자·영문을 지운 판본에서도 찾기 때문에, 서로 다른 두 단어가
 * 붙으면서 우연히 욕설이 되는 사고가 있었다.
 *   · '병신'  ← "간병 신청", "발병 신고", "예방 신청"  → 간병신청
 *   · '자살해' ← "혼자 살해"                          → 혼자살해
 *   · '니미'  ← "어머니 미소"                         → 어머니미소
 * 이 셋은 진짜 욕이기도 해서 지우기는 아까우니, 붙여 쓴 경우에만 잡는다. 띄어 쓴
 * 우회('병 신')는 놓치지만 그건 신고로 대응한다 — 정상 문장을 막는 쪽이 더 나쁘다.
 *
 * ('개년'은 "3개년 계획"처럼 숫자와 붙어 버려 이 방법으로도 못 걸러 아예 삭제했다.
 *  '녀' 계열 욕설은 '썅년'·'미친년'·'김치녀'가 이미 잡는다. 영문 'sex'도 "unisex"·
 *  "Essex" 때문에 삭제 — 한글 '섹스'는 애초에 목록에 없었다.)
 */
const EXACT_WORDS = ['병신', '자살해', '니미']

// 홍보·연락처 유도. 게시판에서 가장 먼저 들어오는 종류다.
const SPAM_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /open\.?kakao\.com|오픈\s*채팅|오픈\s*카톡|오카방/i, why: '오픈채팅 링크·안내' },
  { re: /t\.me\/|텔레\s*그램|telegram/i, why: '텔레그램 안내' },
  { re: /\b01[016789][-. ]?\d{3,4}[-. ]?\d{4}\b/, why: '전화번호' },
  { re: /카톡\s*(아이디|id)|카카오톡\s*(아이디|id)/i, why: '카톡 아이디 안내' },
  { re: /(입금|계좌|송금)\s*(부탁|요청|주세요)/, why: '금전 요구' },
]

// 링크는 '외부면 무조건 차단'이 아니라 허용 목록으로 본다. 사용자가 다녀온 모임 링크나
// 후기 블로그를 공유하는 건 정상이고, 그걸 막으면 게시판이 안 돌아간다.
// 2026-08-12 오너 지시로 대폭 확대 — 목록이 너무 좁아서 티스토리·브런치 같은 흔한
// 블로그·SNS·지도·설문폼까지 전부 차단되고 있었다. 오픈채팅(open.kakao.com)만은
// SPAM_PATTERNS에서 별도로 항상 막는다(이 앱 특성상 홍보·사기 유도의 대표 경로).
const ALLOWED_HOSTS = [
  // 블로그·SNS
  'naver.com', 'daum.net', 'instagram.com', 'youtube.com', 'youtu.be',
  'tistory.com', 'blog.me', 'brunch.co.kr', 'velog.io', 'medium.com',
  'x.com', 'twitter.com', 'threads.net', 'facebook.com', 'tiktok.com',
  'band.us', 'pinterest.com', 'tumblr.com',
  // 지도·설문·문서(모임 장소 안내, 참가 신청서 등)
  'map.kakao.com', 'place.map.kakao.com', 'maps.google.com', 'goo.gl',
  'forms.gle', 'docs.google.com', 'drive.google.com', 'photos.google.com',
  'notion.site', 'notion.so', 'imgur.com',
  // 참고·백과
  'wikipedia.org', 'github.com',
  // 우리가 다루는 업체(모임 링크 공유)
  'frip.co.kr', 'munto.kr', 'modparty.co.kr', 'emotional0ranges.com',
  'talkblossom.co.kr', 'lovecasting.co.kr', 'secretsalon.co.kr',
  '2yeonsi.com', 'lovecommunity.imweb.me', 'yeonin.co.kr',
  // 우리 서비스
  'ourmine.co.kr',
]

/** 허용 목록 밖 링크가 있으면 그 호스트를 돌려준다. */
function foreignLink(text: string): string | null {
  const urls = text.match(/https?:\/\/[^\s<>"']+/gi) || []
  for (const u of urls) {
    const host = (u.match(/^https?:\/\/([^/:?#]+)/i)?.[1] || '').toLowerCase().replace(/^www\./, '')
    if (!host) continue
    if (!ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return host
  }
  return null
}

/**
 * 변형을 걷어낸다. '시 발' '시!발' 'ㅅ.ㅂ' 이 모두 같은 문자열이 되게.
 * 숫자·영문을 사이에 끼우는 수법('시1발', '병１신')은 바꿔치기가 아니라 통째로
 * 지운 판본을 따로 만들어 함께 검사한다. 바꿔치기만 하면 '시ㅣ발'이 되어 안 걸린다.
 */
function stripNoise(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[\s​]/g, '')                        // 공백·제로폭
    .replace(/[.,!?~\-_*^'"`|\\/()[\]{}]/g, '')     // 흔한 끼워넣기 기호
}

/** 한글 사이에 낀 숫자·영문까지 지운 판본(변형 잡이용) */
function stripFillers(text: string): string {
  return stripNoise(text).replace(/[0-9０-９a-z]/g, '')
}

/**
 * @param allowContact 비밀 댓글 전용. 연락처·링크 검사를 건너뛴다.
 *   비밀 댓글은 존재 이유 자체가 "동행 구할 때 연락처·인스타를 주고받는 것"이라
 *   (2026-08-12 오너 지시) 전화번호·카톡 아이디·오픈채팅을 막으면 기능이 성립하지
 *   않는다. 어차피 글쓴이와 당사자만 보므로 불특정 다수 대상 홍보가 될 수 없다.
 *   욕설(BAD_WORDS·초성)은 비밀 댓글에도 그대로 적용한다.
 */
export function moderate(text: string, allowContact = false): string | null {
  const plain = stripNoise(text)
  const nofill = stripFillers(text)
  for (const w of BAD_WORDS) {
    if (plain.includes(stripNoise(w))) return '부적절한 표현이 포함되어 있습니다.'
    // ⚠️ 영문 금칙어는 필러 제거판이 빈 문자열이 된다('fuck' → ''). 빈 문자열은
    //    어떤 텍스트에나 포함되므로 그대로 두면 모든 글이 차단된다(2026-07-31 실제 발생).
    const f = stripFillers(w)
    if (f && nofill.includes(f)) return '부적절한 표현이 포함되어 있습니다.'
  }
  for (const w of CHOSUNG_WORDS) {
    if (plain.includes(w) || nofill.includes(w)) return '부적절한 표현이 포함되어 있습니다.'
  }
  // 붙여 쓴 경우에만 잡는 것들 — 공백을 살린 판본에서 찾는다(위 EXACT_WORDS 주석 참고).
  const spaced = (text || '').toLowerCase().replace(/[.,!?~\-_*^'"`|\\/()[\]{}]/g, '')
  for (const w of EXACT_WORDS) {
    if (spaced.includes(w)) return '부적절한 표현이 포함되어 있습니다.'
  }
  if (allowContact) return null
  // 홍보 패턴·링크는 원문 그대로 본다(정규화하면 링크가 깨진다)
  for (const { re, why } of SPAM_PATTERNS) {
    if (re.test(text)) return `홍보성 내용은 올릴 수 없습니다(${why}).`
  }
  const host = foreignLink(text)
  if (host) return `허용되지 않은 링크입니다(${host}).`
  return null
}

// ── 공통 ─────────────────────────────────────────────────────────────────
const TITLE_MAX = 60
const CONTENT_MAX = 10000
const COMMENT_MAX = 1000
const NICK_MIN = 2
const NICK_MAX = 20

// ── 게시글 첨부 유튜브 링크(2026-08-13) ─────────────────────────────────
// 인앱 재생은 안 하고(WebView·영상플레이어 미설치, 넣으려면 새 네이티브 빌드
// 필요) 외부(유튜브 앱/브라우저)에서 재생 — youtube.com/youtu.be 는 이미
// 아웃링크 허용 목록에 있다(app/lib/security.ts). 다른 링크 종류(인스타 릴스·
// 틱톡 등)는 공식 썸네일 API가 없어 1단계에서는 뺐다(오너 결정).
// 오너 결정(2026-08-13): 유튜브 링크는 아웃링크라 서버 비용이 없어 갯수를 막지 않는다.
// 신고·차단 등 admin 운영으로 스팸을 관리한다. 이 값은 화면에 보여주는 제한이 아니라
// API 오남용(예: 앱을 거치지 않고 함수를 직접 호출)만 막는 안전판이다.
const MAX_LINKS = 30
// 사진 10장 + 움짤 여유분을 합친 서버 안전판(2026-08-13). lib/boardImage.ts의 MAX_IMAGES와 별개.
const MAX_ATTACHED_IMAGES = 15
function youtubeId(raw: string): string | null {
  try {
    const u = new URL(raw)
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '')
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1)
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
    }
    if (host === 'youtube.com') {
      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v') ?? ''
        return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
      }
      const m = u.pathname.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})/)
      return m ? m[1] : null
    }
    return null
  } catch {
    return null
  }
}
// 인스타그램 게시물·릴스만(2026-08-24, 유튜브 옆에 추가) — 앱 쪽 lib/instagram.ts와 동일 규칙.
function isInstagramUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    const host = u.hostname.replace(/^www\./, '')
    if (host !== 'instagram.com') return false
    return /^\/(p|reel|reels|tv)\//.test(u.pathname)
  } catch {
    return false
  }
}
/** linkUrls 원본을 검증 — 하나라도 유튜브·인스타가 아니면 에러 문구를 돌려준다. */
function resolveLinks(raw: unknown): { links: string[] } | { error: string } {
  if (!Array.isArray(raw)) return { links: [] }
  const links = raw.map((u) => String(u).trim()).filter(Boolean).slice(0, MAX_LINKS)
  for (const u of links) {
    if (!youtubeId(u) && !isInstagramUrl(u)) return { error: '유튜브·인스타그램 링크만 첨부할 수 있어요.' }
  }
  return { links }
}

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const action = String(body.action ?? '')
  const token = String(body.ownerToken ?? '')
  if (!token) return json({ error: '필수값 누락' }, 400)
  const hash = await sha256(token)

  // 차단된 기기는 쓰기 자체를 막는다(애플 1.2 요건)
  const { data: blocked } = await supabase
    .from('board_blocks').select('owner_token').eq('owner_token', hash).maybeSingle()
  if (blocked) return json({ error: '이용이 제한된 사용자입니다.' }, 403)

  const { data: cfg } = await supabase.from('board_settings').select('*').eq('id', true).single()

  /** 도배 방지 — 같은 기기가 직전에 쓴 시각과의 간격을 본다. */
  async function tooSoon(table: 'board_posts' | 'board_comments', seconds: number) {
    const { data } = await supabase
      .from(table).select('created_at').eq('owner_token', hash)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!data) return false
    const gap = (Date.now() - new Date(data.created_at).getTime()) / 1000
    return gap < seconds
  }

  /** 내 것인지 확인. 아니면 에러 문구를 돌려준다. */
  async function mine(table: 'board_posts' | 'board_comments', id: string) {
    const { data } = await supabase.from(table).select('owner_token').eq('id', id).maybeSingle()
    if (!data) return '글을 찾을 수 없습니다.'
    if (data.owner_token !== hash) return '본인이 쓴 것만 수정·삭제할 수 있어요.'
    return null
  }

  /**
   * 말머리(태그) 검증 — admin이 등록한 종류만 붙을 수 있다(2026-08-12). 빈 값/undefined 는
   * "선택 안 함"으로 null 반환. 존재하지 않는 id 는 에러 문구를 돌려준다.
   */
  async function resolveTagId(raw: unknown): Promise<{ tagId: string | null } | { error: string }> {
    if (raw == null || raw === '') return { tagId: null }
    const id = String(raw)
    const { data } = await supabase.from('board_tags').select('id').eq('id', id).maybeSingle()
    if (!data) return { error: '선택한 말머리를 찾을 수 없습니다.' }
    return { tagId: id }
  }

  try {
    // ── 글 작성 ──
    if (action === 'createPost') {
      const nick = String(body.nickname ?? '').trim()
      const title = String(body.title ?? '').trim()
      const content = String(body.content ?? '').trim()
      // 첨부 아래에 이어 쓰는 본문(2026-08-21). 첨부가 있을 때만 앱이 보내온다. 없으면 빈 문자열.
      const contentBelow = String(body.contentBelow ?? '').trim()
      // 사진은 10장, 움짤(GIF)은 갯수 대신 5MB로만 제한한다(2026-08-13 오너 지시) —
      // 여기 15는 그 둘을 합친 서버 안전판일 뿐, 화면에 보여주는 제한은 lib/boardImage.ts에 있다.
      const images: string[] = Array.isArray(body.imageUrls) ? body.imageUrls.slice(0, MAX_ATTACHED_IMAGES) : []
      const linksResult = resolveLinks(body.linkUrls)
      if ('error' in linksResult) return json({ error: linksResult.error }, 400)

      if (nick.length < NICK_MIN || nick.length > NICK_MAX)
        return json({ error: `닉네임은 ${NICK_MIN}~${NICK_MAX}자로 입력해주세요.` }, 400)
      if (!title || title.length > TITLE_MAX)
        return json({ error: `제목은 1~${TITLE_MAX}자로 입력해주세요.` }, 400)
      if (!content || content.length > CONTENT_MAX)
        return json({ error: `본문은 1~${CONTENT_MAX}자로 입력해주세요.` }, 400)
      // 아랫글도 같은 상한·모더레이션 적용. 아랫글은 있어도 되고 없어도 된다(첨부 있을 때만 입력됨).
      if (contentBelow.length > CONTENT_MAX)
        return json({ error: `첨부 아래 본문은 ${CONTENT_MAX}자 이내로 입력해주세요.` }, 400)
      const bad = moderate(`${nick} ${title} ${content} ${contentBelow}`)
      if (bad) return json({ error: bad }, 400)
      const tagResult = await resolveTagId(body.tagId)
      if ('error' in tagResult) return json({ error: tagResult.error }, 400)
      if (await tooSoon('board_posts', cfg?.post_cooldown_seconds ?? 30))
        return json({ error: '잠시 후에 다시 올려주세요.' }, 429)

      const videos: string[] = Array.isArray(body.videoUrls) ? body.videoUrls.slice(0, 3) : []
      const { data, error } = await supabase.from('board_posts').insert({
        nickname: nick, title, content, content_below: contentBelow || null, owner_token: hash,
        image_urls: images.length ? images : null,
        link_urls: linksResult.links.length ? linksResult.links : null,
        video_urls: videos.length ? videos : null,
        tag_id: tagResult.tagId,
      }).select('id').single()
      if (error) return json({ error: error.message }, 500)
      return json({ post: data })
    }

    // ── 투표 만들기(글 소유자만) ──
    if (action === 'createPoll') {
      const postId = String(body.postId ?? '')
      const ownErr = await mine('board_posts', postId)
      if (ownErr) return json({ error: ownErr }, 403)
      const question = String(body.question ?? '').trim()
      const allowMulti = !!body.allowMulti
      const endsAt = body.endsAt ? String(body.endsAt) : null
      const options = (Array.isArray(body.options) ? body.options : [])
        .map((o: unknown) => String(o ?? '').trim()).filter(Boolean).slice(0, 5)
      if (options.length < 2) return json({ error: '투표 항목을 2개 이상 입력해주세요.' }, 400)
      if (question.length > 200) return json({ error: '투표 질문이 너무 깁니다.' }, 400)
      const bad = moderate(`${question} ${options.join(' ')}`)
      if (bad) return json({ error: bad }, 400)
      const { data: poll, error: e1 } = await supabase.from('board_polls')
        .insert({ post_id: postId, question: question || null, allow_multi: allowMulti, ends_at: endsAt })
        .select('id').single()
      if (e1) return json({ error: e1.message }, 500)
      const rows = options.map((label: string, i: number) => ({ poll_id: poll.id, position: i, label }))
      const { error: e2 } = await supabase.from('board_poll_options').insert(rows)
      if (e2) return json({ error: e2.message }, 500)
      return json({ pollId: poll.id })
    }

    // ── 투표 조회(옵션·집계·내 표) ──
    if (action === 'getPoll') {
      const postId = String(body.postId ?? '')
      const { data: poll } = await supabase.from('board_polls')
        .select('id,question,allow_multi,ends_at').eq('post_id', postId).maybeSingle()
      if (!poll) return json({ poll: null })
      const { data: opts } = await supabase.from('board_poll_options')
        .select('id,position,label').eq('poll_id', poll.id).order('position')
      const { data: votes } = await supabase.from('board_poll_votes')
        .select('option_id,owner_token').eq('poll_id', poll.id)
      const counts: Record<string, number> = {}
      const voters = new Set<string>()
      const myVotes: string[] = []
      for (const v of (votes ?? []) as { option_id: string; owner_token: string }[]) {
        counts[v.option_id] = (counts[v.option_id] ?? 0) + 1
        voters.add(v.owner_token)
        if (v.owner_token === hash) myVotes.push(v.option_id)
      }
      return json({ poll: {
        id: poll.id, question: poll.question, allowMulti: poll.allow_multi, endsAt: poll.ends_at,
        options: (opts ?? []).map((o: any) => ({ id: o.id, label: o.label, count: counts[o.id] ?? 0 })),
        totalVoters: voters.size, myVotes,
      } })
    }

    // ── 투표하기(재투표=변경, 마감 전) ──
    if (action === 'votePoll') {
      const pollId = String(body.pollId ?? '')
      const optionIds = (Array.isArray(body.optionIds) ? body.optionIds : []).map((x: unknown) => String(x))
      const { data: poll } = await supabase.from('board_polls').select('id,allow_multi,ends_at').eq('id', pollId).maybeSingle()
      if (!poll) return json({ error: '투표를 찾을 수 없습니다.' }, 404)
      if (poll.ends_at && new Date(poll.ends_at) < new Date()) return json({ error: '마감된 투표입니다.' }, 400)
      const { data: validOpts } = await supabase.from('board_poll_options').select('id').eq('poll_id', pollId)
      const valid = new Set((validOpts ?? []).map((o: any) => o.id))
      const chosen = optionIds.filter((id: string) => valid.has(id))
      if (chosen.length === 0) return json({ error: '항목을 선택해주세요.' }, 400)
      const finalChosen = poll.allow_multi ? chosen : chosen.slice(0, 1)
      await supabase.from('board_poll_votes').delete().eq('poll_id', pollId).eq('owner_token', hash)
      const rows = finalChosen.map((oid: string) => ({ poll_id: pollId, option_id: oid, owner_token: hash }))
      const { error } = await supabase.from('board_poll_votes').insert(rows)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    // ── 글 조회(수정 화면용) ──
    // 앱은 보통 RLS로 직접 읽지만(hooks/useBoard.ts), RLS는 is_active인 글만 보여준다.
    // 신고 누적으로 숨김 처리된 내 글은 본인도 못 읽어와 수정 화면이 빈 채로 뜨고
    // "등록" 버튼이 영원히 안 눌리는 문제가 있었다(2026-08 애플 심사 2.1 반려).
    // 소유권만 확인하면 되므로 여기서 서비스 롤로 대신 읽어준다.
    if (action === 'getPost') {
      const id = String(body.postId ?? '')
      const { data } = await supabase.from('board_posts')
        .select('nickname,title,content,content_below,image_urls,link_urls,tag_id,board_tags(label),owner_token').eq('id', id).maybeSingle()
      if (!data) return json({ error: '글을 찾을 수 없습니다.' }, 404)
      if (data.owner_token !== hash) return json({ error: '본인이 쓴 것만 수정할 수 있어요.' }, 403)
      // 지금은 비활성화된 말머리라도 수정 화면에 '현재 선택'으로 보여줘야 하니 라벨을 같이 준다.
      const { owner_token: _omit, board_tags, ...rest } = data as typeof data & { board_tags: { label: string } | null }
      const post = { ...rest, tag_label: board_tags?.label ?? null }
      return json({ post })
    }

    // ── 글 수정 ──
    if (action === 'updatePost') {
      const id = String(body.postId ?? '')
      const err = await mine('board_posts', id)
      if (err) return json({ error: err }, 403)

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (body.title != null) {
        const title = String(body.title).trim()
        if (!title || title.length > TITLE_MAX)
          return json({ error: `제목은 1~${TITLE_MAX}자로 입력해주세요.` }, 400)
        patch.title = title
      }
      if (body.content != null) {
        const content = String(body.content).trim()
        if (!content || content.length > CONTENT_MAX)
          return json({ error: `본문은 1~${CONTENT_MAX}자로 입력해주세요.` }, 400)
        patch.content = content
      }
      // 아랫글 — 빈 문자열이면 NULL 로 지운다(첨부를 다 뺀 경우 등). undefined면 안 건드림.
      if (body.contentBelow != null) {
        const cb = String(body.contentBelow).trim()
        if (cb.length > CONTENT_MAX)
          return json({ error: `첨부 아래 본문은 ${CONTENT_MAX}자 이내로 입력해주세요.` }, 400)
        patch.content_below = cb || null
      }
      if (Array.isArray(body.imageUrls)) patch.image_urls = body.imageUrls.slice(0, MAX_ATTACHED_IMAGES)
      if (Array.isArray(body.linkUrls)) {
        const linksResult = resolveLinks(body.linkUrls)
        if ('error' in linksResult) return json({ error: linksResult.error }, 400)
        patch.link_urls = linksResult.links.length ? linksResult.links : null
      }
      // 'tagId' in body 로 확인 — 말머리를 없애는 것(null)과 아예 안 건드리는 것(undefined)을
      // 구분해야 한다. undefined면 이 요청에서 말머리는 그대로 둔다.
      if ('tagId' in body) {
        const tagResult = await resolveTagId(body.tagId)
        if ('error' in tagResult) return json({ error: tagResult.error }, 400)
        patch.tag_id = tagResult.tagId
      }
      const bad = moderate(`${patch.title ?? ''} ${patch.content ?? ''}`)
      if (bad) return json({ error: bad }, 400)

      const { error } = await supabase.from('board_posts').update(patch).eq('id', id)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    // ── 글 삭제 ──
    if (action === 'deletePost') {
      const id = String(body.postId ?? '')
      const err = await mine('board_posts', id)
      if (err) return json({ error: err }, 403)
      const { error } = await supabase.from('board_posts').delete().eq('id', id)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    // ── 댓글 작성 ──
    if (action === 'createComment') {
      const postId = String(body.postId ?? '')
      const parentId = body.parentId ? String(body.parentId) : null
      const nick = String(body.nickname ?? '').trim()
      const content = String(body.content ?? '').trim()

      const isSecret = body.isSecret === true

      if (nick.length < NICK_MIN || nick.length > NICK_MAX)
        return json({ error: `닉네임은 ${NICK_MIN}~${NICK_MAX}자로 입력해주세요.` }, 400)
      if (!content || content.length > COMMENT_MAX)
        return json({ error: `댓글은 1~${COMMENT_MAX}자로 입력해주세요.` }, 400)
      // ⚠️ 닉네임과 본문을 따로 검사한다. 예전엔 둘을 이어 붙여 한 번에 검사하면서
      //    isSecret 면 연락처 검사를 통째로 껐는데, 닉네임은 비밀이 아니라 모두에게
      //    보이는 값이라(공개 컬럼) 닉네임을 '010-1234-5678'로 두고 비밀 체크만 하면
      //    전화번호·오픈채팅 아이디를 전체 공개로 뿌릴 수 있었다(2026-08-13 감사).
      //    본문만 면제 대상이다.
      const badNick = moderate(nick, false)
      if (badNick) return json({ error: badNick }, 400)
      const bad = moderate(content, isSecret)
      if (bad) return json({ error: bad }, 400)
      if (await tooSoon('board_comments', cfg?.comment_cooldown_seconds ?? 10))
        return json({ error: '잠시 후에 다시 남겨주세요.' }, 429)

      // 비밀 댓글 본문은 앱이 직접 못 읽는 컬럼에만 넣는다. content 는 빈 문자열로 남겨
      // 목록에서 '🔒 비밀 댓글' 로만 보이게 한다(마이그레이션 주석 참고).
      const { data, error } = await supabase.from('board_comments').insert({
        post_id: postId, parent_id: parentId, nickname: nick, owner_token: hash,
        content: isSecret ? '' : content,
        secret_content: isSecret ? content : null,
        is_secret: isSecret,
      }).select('id').single()
      // 대댓글의 대댓글은 DB 트리거가 막는다 → 사용자 문구로 바꿔 전달
      if (error) {
        if (error.message.includes('답글을 달 수 없습니다'))
          return json({ error: '답글에는 다시 답글을 달 수 없습니다.' }, 400)
        return json({ error: error.message }, 500)
      }
      return json({ comment: data })
    }

    // ── 댓글 수정 ──
    if (action === 'updateComment') {
      const id = String(body.commentId ?? '')
      const err = await mine('board_comments', id)
      if (err) return json({ error: err }, 403)
      const content = String(body.content ?? '').trim()
      if (!content || content.length > COMMENT_MAX)
        return json({ error: `댓글은 1~${COMMENT_MAX}자로 입력해주세요.` }, 400)
      // 비밀 여부는 작성 시점에 정해진 그대로 따른다(수정하면서 공개/비밀을 바꾸면
      // 이미 본 사람과 못 본 사람이 생겨 혼란스럽다). 어느 컬럼에 쓸지도 여기서 갈린다.
      const { data: cur } = await supabase.from('board_comments')
        .select('is_secret').eq('id', id).maybeSingle()
      const isSecret = cur?.is_secret === true
      const bad = moderate(content, isSecret)
      if (bad) return json({ error: bad }, 400)
      const { error } = await supabase.from('board_comments').update({
        content: isSecret ? '' : content,
        secret_content: isSecret ? content : null,
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    // ── 비밀 댓글 본문 조회 ──
    // 앱은 board_comments 를 RLS로 직접 읽지만 secret_content 는 권한이 없어 못 읽는다.
    // 여기서 요청자의 기기 해시를 확인해 볼 자격이 있는 것만 골라 내려준다.
    //   · 그 댓글을 쓴 본인
    //   · 게시글 작성자
    //   · (대댓글이면) 원 댓글을 쓴 사람 — 없으면 글쓴이가 답해도 물어본 사람이 못 본다
    // postId 를 주면 그 글의 비밀 댓글 전체를, commentIds 를 주면 그 댓글들만 본다
    // ('내가 쓴 댓글' 목록용).
    if (action === 'secretComments') {
      const postId = body.postId ? String(body.postId) : null
      const commentIds: string[] = Array.isArray(body.commentIds)
        ? body.commentIds.slice(0, 200).map(String) : []
      if (!postId && !commentIds.length) return json({ contents: {} })

      let q = supabase.from('board_comments')
        .select('id,post_id,parent_id,owner_token,secret_content')
        .eq('is_secret', true).eq('is_active', true)
      q = postId ? q.eq('post_id', postId) : q.in('id', commentIds)
      const { data: rows } = await q
      const list = (rows ?? []) as Array<{
        id: string; post_id: string; parent_id: string | null
        owner_token: string; secret_content: string | null
      }>
      if (!list.length) return json({ contents: {} })

      // 글쓴이 판정 — 여러 글이 섞일 수 있으니(commentIds 경로) 글 단위로 모아 한 번에 읽는다.
      const postIds = [...new Set(list.map((c) => c.post_id))]
      const { data: postRows } = await supabase.from('board_posts')
        .select('id,owner_token').in('id', postIds)
      const postOwner = new Map((postRows ?? []).map((p: any) => [p.id, p.owner_token]))

      // 원 댓글 작성자 판정 — 대댓글의 부모는 조회 범위 밖일 수 있어 따로 읽는다.
      const parentIds = [...new Set(list.map((c) => c.parent_id).filter(Boolean))] as string[]
      const parentOwner = new Map<string, string>()
      if (parentIds.length) {
        const { data: parentRows } = await supabase.from('board_comments')
          .select('id,owner_token').in('id', parentIds)
        for (const p of (parentRows ?? []) as any[]) parentOwner.set(p.id, p.owner_token)
      }

      const contents: Record<string, string> = {}
      for (const c of list) {
        const allowed =
          c.owner_token === hash ||
          postOwner.get(c.post_id) === hash ||
          (c.parent_id ? parentOwner.get(c.parent_id) === hash : false)
        if (allowed && c.secret_content != null) contents[c.id] = c.secret_content
      }
      return json({ contents })
    }

    // ── 댓글 삭제 ──
    if (action === 'deleteComment') {
      const id = String(body.commentId ?? '')
      const err = await mine('board_comments', id)
      if (err) return json({ error: err }, 403)
      const { error } = await supabase.from('board_comments').delete().eq('id', id)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    // ── 추천 · 비추 (같은 것을 다시 누르면 취소) ──
    if (action === 'vote') {
      const postId = String(body.postId ?? '')
      const value = Number(body.value)
      if (value !== 1 && value !== -1) return json({ error: '잘못된 요청입니다.' }, 400)

      const { data: prev } = await supabase.from('board_votes')
        .select('value').eq('post_id', postId).eq('owner_token', hash).maybeSingle()

      if (prev && prev.value === value) {
        await supabase.from('board_votes').delete()
          .eq('post_id', postId).eq('owner_token', hash)
        return json({ ok: true, my: 0 })
      }
      const { error } = await supabase.from('board_votes')
        .upsert({ post_id: postId, owner_token: hash, value }, { onConflict: 'post_id,owner_token' })
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true, my: value })
    }

    // ── 스크랩(북마크) 토글 ── 2026-08-21
    // vote 와 같은 (post_id, owner_token) 구조. 이미 있으면 해제, 없으면 추가.
    // board_scraps 는 앱이 못 읽으므로(RLS revoke) 여기 service_role 로만 넣고 지운다.
    if (action === 'scrap') {
      const postId = String(body.postId ?? '')
      if (!postId) return json({ error: '잘못된 요청입니다.' }, 400)
      const { data: prev } = await supabase.from('board_scraps')
        .select('post_id').eq('post_id', postId).eq('owner_token', hash).maybeSingle()
      if (prev) {
        await supabase.from('board_scraps').delete()
          .eq('post_id', postId).eq('owner_token', hash)
        return json({ ok: true, scrapped: false })
      }
      const { error } = await supabase.from('board_scraps')
        .insert({ post_id: postId, owner_token: hash })
      // 23505(중복) 은 이미 스크랩된 상태 — 성공으로 본다.
      if (error && (error as any).code !== '23505') return json({ error: error.message }, 500)
      return json({ ok: true, scrapped: true })
    }

    // ── 내 스크랩 글 목록 ── MY 탭 "스크랩한 글"
    // owner_token 로 스크랩 행을 최신순으로 뽑고, 살아있는(is_active) 글만 돌려준다.
    // owner_token 은 절대 응답에 넣지 않는다(글쓴이 owner_token 도 제외).
    if (action === 'myScraps') {
      const { data: rows } = await supabase.from('board_scraps')
        .select('post_id, created_at').eq('owner_token', hash)
        .order('created_at', { ascending: false }).limit(200)
      const ids = (rows ?? []).map((r: any) => r.post_id)
      if (ids.length === 0) return json({ posts: [] })
      const { data: posts } = await supabase.from('board_posts')
        .select('id,nickname,title,content,image_urls,link_urls,upvotes,downvotes,comment_count,view_count,tag_id,board_tags(label),is_active,content_hidden,created_at')
        .in('id', ids).eq('is_active', true)
      const byId = new Map((posts ?? []).map((p: any) => {
        const { board_tags, ...rest } = p
        return [p.id, { ...rest, tag_label: board_tags?.label ?? null }]
      }))
      // 스크랩한 순서(최신순)를 유지하고, 그새 삭제/숨김된 글은 자동으로 빠진다.
      const ordered = ids.map((id: string) => byId.get(id)).filter(Boolean)
      return json({ posts: ordered })
    }

    // ── 신고 (글 / 댓글 / 이미지) ──
    if (action === 'report') {
      const targetType = String(body.targetType ?? '')
      const targetId = String(body.targetId ?? '')
      // 'image' → 'content' 로 일반화(2026-08-13) — 사진·유튜브 링크 등 첨부물 전체를
      // 한 종류로 신고한다(supabase/migrations/20260813f_board_content_report_unify.sql).
      if (!['post', 'comment', 'content'].includes(targetType))
        return json({ error: '잘못된 요청입니다.' }, 400)
      const { error } = await supabase.from('board_reports').insert({
        target_type: targetType, target_id: targetId,
        reporter_token: hash, reason: body.reason ?? null,
      })
      if (error) {
        if ((error as any).code === '23505') return json({ ok: true, already: true })
        return json({ error: error.message }, 500)
      }
      return json({ ok: true })
    }

    // ── 이미지 업로드 ──
    // 앱에서 곧바로 Storage 에 올리게 하면 익명 사용자에게 쓰기 권한을 열어야 한다.
    // 여기로 받으면 차단된 기기를 먼저 걸러내고(위 board_blocks 검사) 크기·형식도 본다.
    if (action === 'uploadImage') {
      const dataUrl = String(body.dataUrl ?? '')
      // gif 추가(2026-08-13) — 정지사진과 달리 클라이언트에서 리사이즈·재인코딩을 안 하고
      // 원본 그대로 보낸다(움짤 압축용 애니메이션 GIF 처리 모듈이 없어, 다시 구우면
      // 움직임이 사라진다). 그래서 원본 용량 그대로 5MB 제한에 걸린다.
      const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/)
      if (!m) return json({ error: '지원하지 않는 이미지 형식입니다.' }, 400)
      const [, mime, b64] = m
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      if (bytes.length > 5 * 1024 * 1024) {
        return json({
          error: mime === 'image/gif'
            ? '움짤(GIF)은 압축 없이 원본 그대로 올라가서 5MB 이하만 첨부할 수 있어요.'
            : '이미지는 5MB 이하만 올릴 수 있습니다.',
        }, 400)
      }
      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : 'jpg'
      // R2 로 업로드(이그레스 무료). 키: board/{소유자해시12}/{uuid}.{ext}
      const key = `board/${hash.slice(0, 12)}/${crypto.randomUUID()}.${ext}`
      try {
        const url = await r2Put(key, bytes, mime)
        return json({ url })
      } catch (e) {
        return json({ error: String(e) }, 500)
      }
    }

    // ── 동영상 업로드용 R2 presigned PUT URL 발급(숨김 기능) ──
    // 앱이 압축한 영상을 R2로 직접 PUT(서버는 URL만 발급, 파일은 안 거침).
    if (action === 'videoUploadUrl') {
      const ext = String(body.ext ?? 'mp4').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'mp4'
      const key = `board/video/${hash.slice(0, 12)}/${crypto.randomUUID()}.${ext}`
      const endpoint = (Deno.env.get('R2_ENDPOINT') ?? '').replace(/\/$/, '')
      const bucket = Deno.env.get('R2_BUCKET') ?? ''
      const signed = await r2.sign(`${endpoint}/${bucket}/${key}`, {
        method: 'PUT', aws: { signQuery: true },
      })
      return json({ uploadUrl: signed.url, publicUrl: `${Deno.env.get('R2_PUBLIC_BASE')}/media/${key}` })
    }

    // ── 조회수 (화면에는 감춰두지만 값은 쌓아둔다) ──
    if (action === 'view') {
      const postId = String(body.postId ?? '')
      await supabase.rpc('increment_board_view', { p_id: postId })
      return json({ ok: true })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    console.error('board fn error:', e)
    return json({ error: String(e) }, 500)
  }
})
