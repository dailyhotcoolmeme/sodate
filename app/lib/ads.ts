import { Platform } from 'react-native'
import { NativeAd, TestIds } from 'react-native-google-mobile-ads'
import * as Updates from 'expo-updates'
import { track } from './analytics'

/**
 * 광고 단위 ID 중앙 관리 파일.
 *
 * ┌─ 출시 전 할 일 ───────────────────────────────────────────────┐
 * │ 애드몹에서 iOS/Android 앱을 각각 등록하고 "네이티브" 광고 단위를 │
 * │ 만든 뒤, 발급받은 광고 단위 ID를 아래 REAL 값에 넣기만 하면 됩니다.│
 * │ (형식: ca-app-pub-XXXXXXXX/XXXXXXXX)                            │
 * │                                                                │
 * │ ⚠️ 이 파일의 ID는 "광고 단위 ID"입니다.                          │
 * │    app.json 의 androidAppId/iosAppId(=앱 ID)와는 별개이며,       │
 * │    앱 ID 2개도 실제 값으로 교체해야 합니다.                        │
 * └────────────────────────────────────────────────────────────────┘
 *
 * 안전장치:
 *  - 개발 빌드(__DEV__)에서는 항상 구글 테스트 광고를 사용합니다.
 *    (실제 광고를 개발 중 클릭하면 애드몹 계정이 정지될 수 있음)
 *  - 실제 ID를 아직 안 넣었으면(빈 문자열) 자동으로 테스트 광고로 폴백합니다.
 *    → ID만 채우면 프로덕션에서 즉시 실광고로 전환됩니다. 다른 코드 수정 불필요.
 */
// 자리별로 광고 단위를 분리(리포트/최적화 목적). AdMob에서 '네이티브' 형식으로 각각 생성.
const REAL = {
  // 피드 목록 사이
  feedNative: {
    ios: 'ca-app-pub-2792582436871752/2969141781',
    android: 'ca-app-pub-2792582436871752/7824094203',
  },
  // 이벤트 상세 신청 버튼 위
  detailNative: {
    ios: 'ca-app-pub-2792582436871752/8391070415',
    android: 'ca-app-pub-2792582436871752/1087295469',
  },
  // 게시판 목록 맨 아래(페이지 번호 밑) — 유일한 배너 광고 슬롯(2026-08-13)
  boardBanner: {
    ios: 'ca-app-pub-2792582436871752/5220516558',
    android: 'ca-app-pub-2792582436871752/6725169912',
  },
  // 소셜링 피드 목록 사이(2026-08-26, 오너 지시 — 소개팅 피드와 같은 방식). 리포트를
  // 소개팅과 분리하려고 feedNative 재사용 대신 전용 단위를 새로 만들었다.
  socialingFeedNative: {
    ios: 'ca-app-pub-2792582436871752/5312891608',
    android: 'ca-app-pub-2792582436871752/2195773676',
  },
  // 혼술바 피드 목록 사이(2026-08-26)
  honsulFeedNative: {
    ios: 'ca-app-pub-2792582436871752/1237915227',
    android: 'ca-app-pub-2792582436871752/5706758799',
  },
  // 혼술바 가게 상세(2026-08-26) — 소개팅 이벤트 상세와 같은 방식.
  honsulDetailNative: {
    ios: 'ca-app-pub-2792582436871752/6434401582',
    android: 'ca-app-pub-2792582436871752/9252136615',
  },
} as const

// 테스트 광고를 쓸지 판정한다.
//
// ⚠️ 예전엔 "Updates.channel === 'production' 일 때만 실광고"였다. 그런데 이 값은
//    앱 시작 직후 비어 있을 수 있어(네이티브 updates 설정을 아직 못 읽은 상태),
//    스토어 빌드인데도 테스트 광고로 떨어지는 실행이 생겼다 — 그 실행은 수익이 0이다.
//    같은 빌드에서 실행마다 테스트 광고가 보였다 안 보였다 한 원인(2026-07-29 오너 관측).
//    그래서 판정을 뒤집는다: "테스트 채널일 때만 테스트 광고", 모르면 실광고.
//
// 내부 테스트 중 실광고를 눌러 계정이 정지되는 건 AdMob '테스트 기기 등록'으로 막는다
// (등록된 기기는 실광고 단위로 요청해도 테스트 광고가 내려온다). 광고 단위를 바꿔치기해
// 막는 방식은 이번처럼 실수로 프로덕션까지 새기 때문에 쓰지 않는다.
const TEST_CHANNELS = new Set(['development', 'preview'])

function useTestAds(): boolean {
  if (__DEV__) return true
  try {
    const ch = Updates.channel
    return !!ch && TEST_CHANNELS.has(ch)
  } catch {
    return false
  }
}

function resolve(real: { ios: string; android: string }, test: string): string {
  if (useTestAds()) return test
  const id = Platform.OS === 'ios' ? real.ios : real.android
  return id || test
}

// ⚠️ 광고 ID는 반드시 "요청하는 시점"에 계산한다. 예전엔 모듈 로드 시점에 상수로 굳혔는데,
//    그때는 Updates.channel이 아직 준비되지 않은 경우가 있어 테스트 광고 ID로 고정돼 버렸다.
//    실행할 때마다 타이밍이 갈려 어떤 실행은 테스트 광고, 어떤 실행은 실광고가 나갔고,
//    테스트 광고가 나간 실행은 수익이 0이다(2026-07-29 안드로이드에서 실제 관측:
//    같은 빌드인데 실행마다 테스트 광고가 보였다 안 보였다 함).
/** 피드 목록 사이 네이티브 광고 단위 ID */
export const getFeedNativeAdUnitId = () => resolve(REAL.feedNative, TestIds.NATIVE)
/** 이벤트 상세 신청 버튼 위 네이티브 광고 단위 ID */
export const getDetailNativeAdUnitId = () => resolve(REAL.detailNative, TestIds.NATIVE)
/** 게시판 목록 맨 아래(페이지 번호 밑) 배너 광고 단위 ID */
export const getBoardBannerAdUnitId = () => resolve(REAL.boardBanner, TestIds.BANNER)
/** 소셜링 피드 목록 사이 네이티브 광고 단위 ID */
export const getSocialingFeedNativeAdUnitId = () => resolve(REAL.socialingFeedNative, TestIds.NATIVE)
/** 혼술바 피드 목록 사이 네이티브 광고 단위 ID */
export const getHonsulFeedNativeAdUnitId = () => resolve(REAL.honsulFeedNative, TestIds.NATIVE)
/** 혼술바 가게 상세 네이티브 광고 단위 ID */
export const getHonsulDetailNativeAdUnitId = () => resolve(REAL.honsulDetailNative, TestIds.NATIVE)

// ── 네이티브 광고 선(先)로딩 풀 ─────────────────────────────────────────────
//
// 예전엔 AdListItem이 화면에 뜰 때(FlatList가 그 행을 마운트할 때)마다 그 자리에서
// NativeAd를 요청했다. 그런데 스크롤이 빨라 그 행이 로드 완료 전에 화면 밖으로
// 밀려나(FlatList 가상화로 언마운트) 버리면, 로드는 성공해도 화면에 뿌리지 못한 채
// 바로 destroy() 됐다 — 스크롤을 멈춘 자리(예: 12번째)만 우연히 살아남아 보이고
// 나머지는 하나도 안 뜨는 것처럼 보인 원인이었다(2026-08-14, DB 실측: feed 슬롯
// 로드 성공 893건 vs 실패 68건으로 로드 자체는 멀쩡했는데 화면엔 거의 안 보였음).
//
// 화면에 뜨는 순간에 요청하는 대신, 미리 몇 개를 항상 대기시켜두고(warmNativeAdPool)
// 행이 마운트되면 그 자리에서 즉시 꺼내 쓴다(claimPooledNativeAd) — 네트워크 왕복
// 없이 동기에 가깝게 반영되므로, 마운트-언마운트 경합이 일어날 틈이 거의 없다.
// 카드형 보기는 광고 간격이 촘촘해(3개마다) 첫 렌더링에서 슬롯 여러 개가 한꺼번에
// 뜰 수 있다 — 그 초기 버스트를 커버할 만큼 넉넉히 잡는다.
const POOL_SIZE = 3
const pools = new Map<string, NativeAd[]>()
const filling = new Map<string, number>()

function fillPool(unitId: string, slot: string): void {
  const pool = pools.get(unitId) ?? []
  pools.set(unitId, pool)
  const inFlight = filling.get(unitId) ?? 0
  const need = POOL_SIZE - pool.length - inFlight
  for (let i = 0; i < need; i++) {
    filling.set(unitId, (filling.get(unitId) ?? 0) + 1)
    NativeAd.createForAdRequest(unitId)
      .then((nativeAd) => {
        pools.get(unitId)?.push(nativeAd)
        track('ad_load_success', { properties: { slot, platform: Platform.OS, unit: unitId } })
      })
      .catch((e) => {
        track('ad_load_fail', {
          properties: {
            slot, platform: Platform.OS, unit: unitId,
            code: e?.code ?? null, message: String(e?.message ?? e).slice(0, 200),
          },
        })
      })
      .finally(() => {
        filling.set(unitId, (filling.get(unitId) ?? 1) - 1)
      })
  }
}

/** 목록 화면 마운트 시 1회 호출 — 첫 행이 뜨기 전에 미리 몇 개를 채워둔다. */
export function warmNativeAdPool(unitId: string, slot: string): void {
  fillPool(unitId, slot)
}

/**
 * 이미 로드돼 대기 중인 광고를 즉시 꺼내 쓴다. 없으면 null — 호출부가 그 자리에서
 * 즉석 요청으로 폴백해야 한다(세션 시작 직후처럼 풀이 아직 안 찼을 때 대비).
 * 꺼내 쓴 만큼 자동으로 보충 요청을 건다.
 */
export function claimPooledNativeAd(unitId: string, slot: string): NativeAd | null {
  const pool = pools.get(unitId)
  const ad = pool?.shift() ?? null
  fillPool(unitId, slot)
  return ad
}
