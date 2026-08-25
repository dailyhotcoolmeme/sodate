import React, { useMemo, useCallback, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import BottomNav from '@/components/BottomNav'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { getRecentViews, clearRecentViews, removeRecentView, type RecentView, type RecentKind } from '@/lib/recentViews'
import { wideContent } from '@/constants/layout'

type Tab = 'all' | 'dating' | 'socialing' | 'place'

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'dating', label: '소개팅' },
  { key: 'socialing', label: '소셜링' },
  { key: 'place', label: '혼술바' },
]

// 바텀 내비(BottomNav.tsx)와 같은 아이콘 — "전체" 탭에서 종류를 한눈에 구분하게 한다.
// 'company'(업체 소개 페이지)는 특정 서비스 하나로 못 묶어 중립 아이콘을 쓴다.
const KIND_ICON: Record<RecentKind, keyof typeof Ionicons.glyphMap> = {
  dating: 'heart', socialing: 'sparkles', place: 'wine', company: 'storefront-outline',
}
const KIND_ROUTE: Record<RecentKind, string> = {
  dating: '/event', socialing: '/event', place: '/place', company: '/company',
}

/**
 * 최근 본 기록 — MY 탭 진입. 일정/업체/매장 상세를 열 때마다 로컬에 쌓인 기록을 최신순으로 본다.
 * 완전히 로컬(기기)이라 앱을 지우면 비워진다. 전체/소개팅/소셜링/혼술바 탭으로 나눈다(2026-08-24).
 */
export default function RecentScreen() {
  const router = useRouter()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [tab, setTab] = useState<Tab>('all')
  const [items, setItems] = useState<RecentView[]>([])
  const [loaded, setLoaded] = useState(false)

  useFocusEffect(useCallback(() => {
    let alive = true
    getRecentViews().then((v) => { if (alive) { setItems(v); setLoaded(true) } })
    return () => { alive = false }
  }, []))

  const filtered = useMemo(
    () => (tab === 'all' ? items : items.filter((v) => v.kind === tab)),
    [items, tab],
  )

  const open = (v: RecentView) => router.push(`${KIND_ROUTE[v.kind]}/${v.id}` as never)

  // 누르자마자 바로 비우지 않고 팝업으로 한 번 확인받고 적용한다(2026-08-25 오너 지시).
  const handleClear = () => {
    Alert.alert('기록 비우기', '최근 본 기록을 모두 지울까요?', [
      { text: '취소', style: 'cancel' },
      { text: '비우기', style: 'destructive', onPress: async () => { await clearRecentViews(); setItems([]) } },
    ])
  }

  // 전체 비우기만 있고 한 줄만 골라 지우는 기능이 없었다(2026-08-25 오너 지시: "선택삭제
  // 기능도 필요하다"). 스크랩한 글(my/scraps.tsx)과 같은 방식 — 줄마다 삭제 버튼.
  const handleRemoveOne = (v: RecentView) => {
    Alert.alert('기록 삭제', `'${v.title}' 기록을 지울까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive',
        onPress: async () => {
          setItems((prev) => prev.filter((p) => !(p.kind === v.kind && p.id === v.id)))
          await removeRecentView(v.kind, v.id)
        },
      },
    ])
  }

  const isEmpty = filtered.length === 0

  return (
    <View style={styles.container}>
      <TopBar showBack title="최근 본 기록" />
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabOn]}
            onPress={() => setTab(t.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.headingRow}>
        {items.length > 0 && (
          <TouchableOpacity onPress={handleClear} hitSlop={8}>
            <Text style={styles.clear}>기록 비우기</Text>
          </TouchableOpacity>
        )}
      </View>

      {loaded && isEmpty ? (
        <View style={styles.center}>
          <Ionicons name="time-outline" size={32} color={colors.textTertiary} />
          <Text style={styles.emptyText}>아직 본 기록이 없어요</Text>
          <Text style={styles.emptySub}>일정·업체·매장을 열어보면 여기에 쌓여요</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[wideContent, { paddingBottom: insets.bottom + 20 }]}>
          {filtered.map((v) => (
            <TouchableOpacity key={`${v.kind}:${v.id}`} style={styles.row} onPress={() => open(v)} activeOpacity={0.7}>
              <Ionicons
                name={KIND_ICON[v.kind] ?? 'time-outline'}
                size={18} color={v.kind === 'company' ? colors.textTertiary : colors.primary} style={styles.rowIcon}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{v.title}</Text>
                {v.sub && <Text style={styles.sub} numberOfLines={1}>{v.sub}</Text>}
              </View>
              <TouchableOpacity
                style={styles.removeBtn}
                onPress={(e) => { e.stopPropagation?.(); handleRemoveOne(v) }}
                activeOpacity={0.7}
                hitSlop={8}
              >
                <Ionicons name="close" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      <BottomNav current="my" route="/my/recent" />
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    // 탭 — 즐겨찾기·알림 설정·혼술바(피드/지도)와 동일한 밑줄 탭 규격.
    tabs: {
      flexDirection: 'row', alignItems: 'flex-end', gap: 18,
      paddingHorizontal: 16, paddingTop: 8,
      borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    tab: { paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabOn: { borderBottomColor: colors.primary },
    tabText: { fontSize: 15, fontWeight: '700', color: colors.textTertiary },
    tabTextOn: { color: colors.textPrimary, fontWeight: '800' },
    headingRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
      paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4,
    },
    clear: { fontSize: 13, color: colors.textTertiary },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 60 },
    emptyText: { fontSize: 15, color: colors.textSecondary, marginTop: 4 },
    emptySub: { fontSize: 13, color: colors.textTertiary },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 11,
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    rowIcon: { width: 22 },
    removeBtn: { padding: 2 },
    title: { fontSize: 14.5, color: colors.textPrimary },
    sub: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  })
}
