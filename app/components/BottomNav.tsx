import React, { useMemo } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { NEW_TABS_ENABLED } from '@/constants/features'

/**
 * 하단 4탭 내비게이션(2026-08-21) — 소개팅·소셜링·혼술바·커뮤니티.
 *
 * ⚠️ 아직 개발 중이라 NEW_TABS_ENABLED 가 false 인 동안 **아무것도 그리지 않는다.**
 *    그래서 운영 앱은 지금 그대로(톱바 토글 2탭) 돌아간다. 완성 후 플래그를 켜고
 *    새 빌드+심사로 전환한다. constants/features.ts 참고.
 *
 * 전환은 router.replace 로 한다 — 지금 소개팅↔커뮤니티(SwipeSegment/톱바 토글)가 쓰는
 * 방식 그대로라 동작이 일관된다. 스와이프 전환은 4탭에선 없앤다(오너 결정: 탭만).
 */
type TabKey = 'event' | 'socialing' | 'honsul' | 'board'

const TABS: { key: TabKey; label: string; route: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'event',     label: '소개팅',   route: '/',          icon: 'heart' },
  { key: 'socialing', label: '소셜링',   route: '/socialing', icon: 'sparkles' },
  { key: 'honsul',    label: '혼술바',   route: '/honsul',    icon: 'wine' },
  { key: 'board',     label: '커뮤니티', route: '/board',     icon: 'chatbubble-ellipses' },
]

export default function BottomNav({ current }: { current: TabKey }) {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const styles = useMemo(() => makeStyles(colors), [colors])

  // 플래그가 꺼져 있으면 렌더 자체를 안 한다 — 운영 앱에 영향 0.
  if (!NEW_TABS_ENABLED) return null

  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom }]}>
      {TABS.map((t) => {
        const on = t.key === current
        return (
          <TouchableOpacity
            key={t.key}
            style={styles.tab}
            activeOpacity={0.7}
            onPress={() => { if (!on) router.replace(t.route as never) }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Ionicons
              name={on ? t.icon : (`${t.icon}-outline` as keyof typeof Ionicons.glyphMap)}
              size={23}
              color={on ? colors.primary : colors.textTertiary}
            />
            <Text style={[styles.label, on && styles.labelOn]}>{t.label}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      backgroundColor: colors.background,
      borderTopWidth: 1, borderTopColor: colors.divider,
    },
    tab: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      gap: 3, paddingTop: 9, paddingBottom: 8,
    },
    label: { fontSize: 10.5, color: colors.textTertiary },
    labelOn: { color: colors.primary, fontWeight: '800' },
  })
}
