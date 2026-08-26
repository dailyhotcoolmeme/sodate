import React, { useEffect, useMemo } from 'react'
import { View, StyleSheet, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { NEW_TABS_ENABLED } from '@/constants/features'
import { saveTabRoute, getTabRoute } from '@/lib/tabMemory'

/**
 * 하단 5탭 내비게이션(2026-08-21) — 소개팅·소셜링·[홈]·혼술바·MY.
 * 가운데 홈(커뮤니티)이 크게 튀어나온 형태(인스타·틱톡의 중앙 강조 버튼과 같은 패턴).
 * 커뮤니티가 본체(매일 오는 곳)라 가운데에 두고 이름 없이 아이콘만 크게 강조한다.
 * 나머지 4개도 2026-08-26 오너 지시로 이름표를 빼고 아이콘만 키워서 쓴다.
 *
 * ⚠️ NEW_TABS_ENABLED 가 false 인 동안 아무것도 그리지 않는다 — 운영 앱은 지금 그대로.
 *    완성 후 플래그를 켜고 새 빌드+심사로 전환한다. constants/features.ts 참고.
 *
 * 전환은 router.replace(지금 소개팅↔커뮤니티가 쓰는 방식 그대로). 스와이프 전환은 없앤다.
 */
type TabKey = 'event' | 'socialing' | 'board' | 'honsul' | 'my'

// 좌우 4개(홈 제외). 가운데 홈은 아래에서 따로 그린다.
const SIDE_TABS: { key: TabKey; label: string; route: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'event',     label: '소개팅', route: '/',          icon: 'heart' },
  { key: 'socialing', label: '소셜링', route: '/socialing', icon: 'sparkles' },
  { key: 'honsul',    label: '혼술바', route: '/honsul',    icon: 'wine' },
  { key: 'my',        label: 'MY',     route: '/my',        icon: 'person' },
]

const CANONICAL_ROUTE: Record<TabKey, string> = {
  event: '/', socialing: '/socialing', honsul: '/honsul', my: '/my', board: '/board',
}

/**
 * route(각 화면이 넘겨주는 자기 자신의 실제 경로, 예: `/event/${id}`) — 예전엔 여기서
 * usePathname() 으로 "지금 경로"를 알아내 저장했는데, 화면 전환 애니메이션 도중에는
 * 옛 화면·새 화면이 잠깐 같이 떠 있을 수 있어 pathname 이 엉뚱한 화면의 것으로 잘못
 * 저장되는 경쟁 상태가 있었다(2026-08-25 오너 확인: "소개팅을 눌러도 소셜링만 눌러진다",
 * "MY 눌러도 혼술바가 눌러진다" — 라우터 타이밍에 좌우되는 값이라 재현이 들쭉날쭉했다).
 * 대신 각 화면이 자기 id 로 직접 만든, 라우터 타이밍과 무관한 고정 문자열을 넘기게 한다.
 */
export default function BottomNav({ current, route }: { current: TabKey; route?: string }) {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const myRoute = route ?? CANONICAL_ROUTE[current]

  // 이 화면이 지금 자기 탭 구역에서 "마지막으로 보던 화면"이 된다 — 상세페이지도 포함.
  // 나중에 다른 탭 갔다가 이 탭으로 돌아오면 목록이 아니라 여기로 돌아온다.
  useEffect(() => {
    if (NEW_TABS_ENABLED) saveTabRoute(current, myRoute)
  }, [current, myRoute])

  // 플래그가 꺼져 있으면 렌더 자체를 안 한다 — 운영 앱에 영향 0.
  if (!NEW_TABS_ENABLED) return null

  const go = (key: TabKey, route: string, active: boolean) => {
    if (active) return
    router.replace((getTabRoute(key) ?? route) as never)
  }
  const boardOn = current === 'board'

  // 좌우 2개씩 나누고 가운데에 홈을 끼운다.
  const left = SIDE_TABS.slice(0, 2)
  const right = SIDE_TABS.slice(2)

  // ⚠️(2026-08-26 오너 지시) 이름표(소개팅·소셜링·혼술바·MY)를 빼고 아이콘만 남겼다.
  // 글자가 빠진 만큼 아이콘을 키워(22→28) 빈 자리를 채운다. 가운데 홈은 원래부터
  // 이름 없이 아이콘만이라 그대로다. 화면에 이름이 안 보이는 대신 스크린리더가 읽을
  // 수 있게 accessibilityLabel 로 이름을 남긴다(빼먹으면 시각장애인이 탭을 구분 못 한다).
  const sideTab = (t: typeof SIDE_TABS[number]) => {
    const on = t.key === current
    return (
      <TouchableOpacity
        key={t.key} style={styles.tab} activeOpacity={0.7}
        onPress={() => go(t.key, t.route, on)}
        accessibilityRole="tab" accessibilityLabel={t.label}
        accessibilityState={{ selected: on }}
      >
        <Ionicons
          name={on ? t.icon : (`${t.icon}-outline` as keyof typeof Ionicons.glyphMap)}
          size={28} color={on ? colors.primary : colors.textTertiary}
        />
      </TouchableOpacity>
    )
  }

  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom }]}>
      {left.map(sideTab)}

      {/* 가운데 홈(커뮤니티) — 크게 튀어나온 원형 버튼, 이름 없이 아이콘만 */}
      <View style={styles.homeSlot}>
        <TouchableOpacity
          style={[styles.homeBtn, boardOn && styles.homeBtnOn]}
          activeOpacity={0.85}
          onPress={() => go('board', '/board', boardOn)}
          accessibilityRole="tab" accessibilityLabel="커뮤니티"
          accessibilityState={{ selected: boardOn }}
        >
          <Ionicons name="chatbubble-ellipses" size={32} color="#fff" />
        </TouchableOpacity>
      </View>

      {right.map(sideTab)}
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    wrap: {
      flexDirection: 'row', alignItems: 'flex-end',
      backgroundColor: colors.background,
      borderTopWidth: 1, borderTopColor: colors.divider,
      paddingHorizontal: 4,
    },
    // 이름표를 뺀 뒤에도 바 높이가 확 줄지 않게 세로 패딩을 늘렸다(기존: 아이콘 22 +
    // gap 3 + 라벨 13 + 패딩 17 ≈ 55 / 지금: 아이콘 28 + 패딩 26 ≈ 54). 탭 터치 영역도
    // 그대로 유지된다.
    tab: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      paddingTop: 14, paddingBottom: 12,
    },
    // 가운데 홈(메인) — 바 위쪽 선을 넘치게 크게 튀어나온다. margin-top 음수로 끌어올린다.
    homeSlot: { flexShrink: 0, marginHorizontal: 6, marginTop: -24 },
    homeBtn: {
      width: 64, height: 64, borderRadius: 999,
      backgroundColor: `${colors.primary}CC`,   // 비선택: 살짝 연하게
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 3, borderColor: colors.background,
      shadowColor: colors.primary, shadowOpacity: 0.44, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    homeBtnOn: { backgroundColor: colors.primary },
  })
}
