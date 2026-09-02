/**
 * 앱 행동 분석 — 비동기 배치 전송
 * - 앱 성능에 영향 없도록 fire-and-forget
 * - 실패 시 조용히 무시
 * - device_id: AsyncStorage 영구 저장
 * - session_id: 앱 실행당 1회 생성 (메모리)
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { supabase } from './supabase'

// 앱 버전 — 모든 기록에 함께 남겨 OTA 도달률을 본다(2026-09-03).
const APP_VERSION: string = Constants.expoConfig?.version ?? 'unknown'

const SESSION_ID = generateId()
let deviceIdCache: string | null = null

// 배치 큐
const queue: AnalyticsPayload[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** 어느 메뉴에서 일어난 일인지. 전역 동작(앱 실행 등)은 안 넣는다.
 *  ⚠️ 기록할 때 같이 남겨야 한다 — 일정 번호로 되짚으면 지난 일정이 지워진 뒤 알 수 없다
 *     (2026-09-03 확인: 최근 60일 행동 기록의 89%가 그래서 메뉴 미상이었다). */
export type AnalyticsMenu = 'dating' | 'socialing' | 'honsul' | 'board'

export type AnalyticsEventType =
  | 'app_open'
  | 'screen_view'
  | 'event_impression'
  | 'event_view'
  | 'event_apply_click'
  | 'event_favorite_add'
  | 'event_favorite_remove'
  | 'alert_subscribe'
  | 'alert_unsubscribe'
  | 'filter_apply'
  | 'filter_reset'
  | 'sort_change'
  | 'company_view'
  | 'review_view'
  | 'review_click'
  | 'participant_stats_view'
  // 광고 결과 계측 — 예전엔 로드 실패를 catch{} 로 삼켜서, 광고가 안 나와도
  // 안 나온다는 사실조차 알 수 없었다(2026-07-28 iOS에서 실제로 겪음).
  // 출시 후 플랫폼별 충전율·오류를 DB에서 바로 볼 수 있게 남긴다.
  | 'ad_load_success'
  | 'ad_load_fail'
  // 자체 홍보 배너(AdMob 아님) 탭 — 커뮤니티 피드 맨 위(2026-08-19).
  // ⚠️ 2026-09-02 배너가 admin 관리형(banners 테이블)으로 바뀌면서 아래 두 종류로 대체됐다.
  //    이 값은 그 전 기록을 읽을 때 필요해서 남겨둔다(새로 쓰지 않는다).
  | 'promo_banner_tap'
  // 메뉴 상단 배너(2026-09-02) — 노출은 "실제로 화면에 보인 장"만 센다.
  // 그래야 "몇 번 보이고 몇 번 눌렸나"가 나온다. properties: { banner_id, menu }
  | 'banner_impression'
  | 'banner_click'
  // ── 메뉴별 계측(2026-09-03) ────────────────────────────────────────────────
  // 그 전에는 소개팅 화면에만 계측이 있어서 소셜링·혼술바·커뮤니티는 기록이 0건이었다.
  /** 메뉴 탭에 들어옴. menu 로 구분한다(예전 screen_view 는 'home' 만 찍혔다) */
  | 'menu_view'
  /** 목록에서 상세로 들어감. 일정·매장·글 공통. properties.title 로 이름을 같이 남겨
   *  내용이 지워진 뒤에도 뭐가 인기였는지 알 수 있게 한다 */
  | 'item_view'
  /** 검색. properties: { term, result_count } — 0건이면 "찾는데 물건이 없다"는 뜻이라
   *  어느 업체를 더 긁어올지 정하는 근거가 된다 */
  | 'search'
  /** 앱 밖으로 나가는 링크(신청·네이버지도·인스타·전화). properties.kind 로 구분 */
  | 'outlink_click'
  /** 혼술바 지도/목록 전환 — 지도에 힘을 더 쓸지 판단용. properties.mode */
  | 'map_mode'
  /** 모잇 할인 안내 팝업을 봄 — 제휴 업체에 보여줄 숫자 */
  | 'partner_notice_view'
  /** 글쓰기 시작 → 등록 완료. 둘 차이가 '쓰다 그만둔 비율'이다 */
  | 'write_start'
  | 'write_submit'
  | 'comment_create'
  | 'post_vote'
  | 'post_scrap'
  /** 공유하기 누름 — 검색 말고 다른 유입이 있는지 보는 단서 */
  | 'share_click'
  /** 알림 권한을 물어본 결과. properties.granted */
  | 'push_permission'
  /** 푸시를 눌러서 앱에 들어옴 — 알림 효과 측정 */
  | 'push_open'
  /** 첫 실행 안내 몇 장째에서 나갔는지. properties.step */
  | 'onboarding_step'

interface AnalyticsPayload {
  event_type: AnalyticsEventType
  event_id?: string
  company_id?: string
  device_id: string
  session_id: string
  platform: string
  /** 어느 메뉴에서 일어난 일인지(전역 동작은 없음) */
  menu?: AnalyticsMenu
  /** 기록 당시 앱 버전 — OTA 가 몇 %에 닿았는지 보려고 모든 기록에 함께 남긴다 */
  app_version?: string
  properties?: Record<string, any>
}

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

async function getDeviceId(): Promise<string> {
  if (deviceIdCache) return deviceIdCache
  try {
    let id = await AsyncStorage.getItem('@sodate_device_id')
    if (!id) {
      id = generateId()
      await AsyncStorage.setItem('@sodate_device_id', id)
    }
    deviceIdCache = id
    return id
  } catch {
    return 'unknown'
  }
}

async function flush() {
  if (queue.length === 0) return
  const batch = queue.splice(0, queue.length)
  try {
    await (supabase as any).from('analytics_events').insert(batch)
  } catch {
    // 분석 실패는 조용히 무시
  }
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flush()
  }, 3000) // 3초 대기 후 배치 전송
}

/**
 * 광고 '로드 성공'은 세션·슬롯당 한 번만 남긴다(2026-09-03).
 * 광고가 뜰 때마다 남기다 보니 두 달에 2만 건 — 전체 기록의 63%가 이것이었다. 표만 커지고
 * 분석에 방해가 된다. 노출 수는 AdMob 콘솔에 더 정확히 나오고, 우리가 여기서 알고 싶은 건
 * "이 기기에서 그 자리에 광고가 뜨긴 하나"뿐이다(2026-07-28 iOS 에서 아예 안 뜨던 일 때문에
 * 넣은 계측이다). **실패(ad_load_fail)는 전부 남긴다** — 그게 진짜 봐야 할 값이다.
 */
const adSuccessSeen = new Set<string>()

export async function track(
  eventType: AnalyticsEventType,
  options?: {
    eventId?: string
    companyId?: string
    /** 소개팅·소셜링·혼술바·커뮤니티 중 어디인지. 전역 동작이면 안 넣는다 */
    menu?: AnalyticsMenu
    properties?: Record<string, any>
  }
) {
  try {
    if (eventType === 'ad_load_success') {
      const key = String(options?.properties?.slot ?? '?')
      if (adSuccessSeen.has(key)) return
      adSuccessSeen.add(key)
    }
    const deviceId = await getDeviceId()
    queue.push({
      event_type: eventType,
      event_id: options?.eventId,
      company_id: options?.companyId,
      device_id: deviceId,
      session_id: SESSION_ID,
      platform: Platform.OS,
      menu: options?.menu,
      app_version: APP_VERSION,
      properties: options?.properties ?? {},
    })
    // 10개 이상 쌓이면 즉시 전송
    if (queue.length >= 10) {
      flush()
    } else {
      scheduleFlush()
    }
  } catch {
    // 추적 실패는 조용히 무시
  }
}
