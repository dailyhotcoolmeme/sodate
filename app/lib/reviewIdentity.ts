import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * 로그인 없는 익명 후기 소유권 관리.
 * - ownerToken: 기기별 영구 랜덤 토큰. 서버는 이 토큰의 해시만 저장하고 응답으로 되돌려주지 않는다.
 * - myReviewIds: 이 기기에서 작성한 후기 id 집합. "내 후기(수정/삭제)" 버튼 노출 판단에 사용.
 * 네이티브 crypto 미사용 — 시간 + Math.random 조합으로 충분히 긴 랜덤 문자열 생성.
 */

const TOKEN_KEY = 'sodate_review_token'
const MY_IDS_KEY = 'sodate_my_review_ids'
const LAST_NICK_KEY = 'sodate_last_nickname'
const LAST_GENDER_KEY = 'sodate_last_gender'

export type ReviewGender = 'male' | 'female'

function generateToken(): string {
  // 40자 이상 보장: 타임스탬프 + Math.random 여러 번 이어붙임
  let token = Date.now().toString(36)
  for (let i = 0; i < 6; i++) {
    token += Math.random().toString(36).slice(2)
  }
  return token
}

/** 기기 소유권 토큰을 가져오거나(없으면) 새로 만들어 저장 후 반환 */
export async function getOrCreateToken(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(TOKEN_KEY)
    if (existing && existing.length >= 40) return existing
    const token = generateToken()
    await AsyncStorage.setItem(TOKEN_KEY, token)
    return token
  } catch {
    // 저장 실패 시에도 세션 내 동작을 위해 임시 토큰 반환
    return generateToken()
  }
}

/** 이 기기에서 작성한 후기 id 목록 */
export async function getMyReviewIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(MY_IDS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** 내 후기 id 추가(중복 제거) */
export async function addMyReviewId(id: string): Promise<void> {
  try {
    const ids = await getMyReviewIds()
    if (ids.includes(id)) return
    ids.push(id)
    await AsyncStorage.setItem(MY_IDS_KEY, JSON.stringify(ids))
  } catch {
    // ignore
  }
}

/** 내 후기 id 제거(삭제 시) */
export async function removeMyReviewId(id: string): Promise<void> {
  try {
    const ids = await getMyReviewIds()
    const next = ids.filter((v) => v !== id)
    await AsyncStorage.setItem(MY_IDS_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

/** 마지막으로 후기 작성/수정에 사용한 닉네임(다음 작성 시 자동 세팅용) */
export async function getLastNickname(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(LAST_NICK_KEY)) ?? ''
  } catch {
    return ''
  }
}

/** 후기 작성/수정 성공 시 닉네임 기억 */
export async function setLastNickname(name: string): Promise<void> {
  try {
    const v = (name ?? '').trim()
    if (v) await AsyncStorage.setItem(LAST_NICK_KEY, v)
  } catch {
    // ignore
  }
}

// ── 닉네임 자동생성(한국어 친근형: 형용사+명사(동물·음식·사물)+숫자2자리) ──
// 데이팅 앱 톤에 맞게 긍정·귀여운 것만. 성적·부정 조합 안 나오게 풀 정제.
const NICK_ADJ = [
  '느긋한', '설레는', '포근한', '다정한', '씩씩한', '엉뚱한', '새침한', '발랄한', '든든한', '나른한',
  '상냥한', '명랑한', '수줍은', '활기찬', '차분한', '사랑스런', '귀여운', '온화한', '따뜻한', '재빠른',
  '폭신한', '몽글한', '초롱한', '야무진', '싱그런', '보드란', '깜찍한', '해맑은', '느릿한', '반짝이는',
]
const NICK_NOUN = [
  // 동물
  '너구리', '수달', '다람쥐', '고슴도치', '알파카', '펭귄', '여우', '토끼', '햄스터', '판다',
  '코알라', '물개', '오리', '참새', '고양이', '강아지', '병아리', '고래', '거북이', '사슴',
  // 음식
  '붕어빵', '마카롱', '복숭아', '딸기', '감자', '도넛', '푸딩', '참외', '귤', '만두', '곰젤리', '떡',
  // 사물
  '구름', '별', '방울', '풍선', '단추', '도토리', '조약돌', '램프', '솜사탕', '우산',
]

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]

/** 새 랜덤 닉네임 하나 생성(저장은 안 함). 예: "느긋한붕어빵42" */
export function generateNickname(): string {
  return `${pick(NICK_ADJ)}${pick(NICK_NOUN)}${10 + Math.floor(Math.random() * 90)}`
}

/** 닉네임이 없으면 자동 생성해 저장하고 돌려준다(있으면 그대로). 최초 진입 시 호출. */
export async function ensureNickname(): Promise<string> {
  const cur = await getLastNickname()
  if (cur) return cur
  const gen = generateNickname()
  await setLastNickname(gen)
  return gen
}

/** 마지막으로 후기에 쓴 성별(닉네임과 같은 방식으로 기기에 한 번만 입력) */
export async function getLastGender(): Promise<ReviewGender | null> {
  try {
    const v = await AsyncStorage.getItem(LAST_GENDER_KEY)
    return v === 'male' || v === 'female' ? v : null
  } catch {
    return null
  }
}

/** 후기 작성/수정 성공 시 성별 기억 */
export async function setLastGender(gender: ReviewGender): Promise<void> {
  try {
    if (gender === 'male' || gender === 'female') {
      await AsyncStorage.setItem(LAST_GENDER_KEY, gender)
    }
  } catch {
    // ignore
  }
}
