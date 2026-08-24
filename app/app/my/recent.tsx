import React, { useMemo, useCallback, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { getRecentViews, clearRecentViews, type RecentView } from '@/lib/recentViews'
import { wideContent } from '@/constants/layout'

/**
 * 최근 본 것 — MY 탭 진입. 이벤트/업체 상세를 열 때마다 로컬에 쌓인 기록을 최신순으로 본다.
 * 완전히 로컬(기기)이라 앱을 지우면 비워진다. 소셜링·혼술바가 붙으면 kind 를 늘려 섞는다.
 */
export default function RecentScreen() {
  const router = useRouter()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [items, setItems] = useState<RecentView[]>([])
  const [loaded, setLoaded] = useState(false)

  useFocusEffect(useCallback(() => {
    let alive = true
    getRecentViews().then((v) => { if (alive) { setItems(v); setLoaded(true) } })
    return () => { alive = false }
  }, []))

  const open = (v: RecentView) =>
    router.push(v.kind === 'event' ? `/event/${v.id}` : `/company/${v.id}`)

  const handleClear = async () => { await clearRecentViews(); setItems([]) }

  const isEmpty = items.length === 0

  return (
    <View style={styles.container}>
      <TopBar showBack title="최근 본 것" />
      <View style={styles.headingRow}>
        {!isEmpty && (
          <TouchableOpacity onPress={handleClear} hitSlop={8}>
            <Text style={styles.clear}>기록 비우기</Text>
          </TouchableOpacity>
        )}
      </View>

      {loaded && isEmpty ? (
        <View style={styles.center}>
          <Ionicons name="time-outline" size={32} color={colors.textTertiary} />
          <Text style={styles.emptyText}>아직 본 것이 없어요</Text>
          <Text style={styles.emptySub}>일정이나 업체를 열어보면 여기에 쌓여요</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[wideContent, { paddingBottom: insets.bottom + 20 }]}>
          {items.map((v) => (
            <TouchableOpacity key={`${v.kind}:${v.id}`} style={styles.row} onPress={() => open(v)} activeOpacity={0.7}>
              <Ionicons
                name={v.kind === 'event' ? 'heart-outline' : 'storefront-outline'}
                size={18} color={colors.textTertiary} style={styles.rowIcon}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{v.title}</Text>
                {v.sub && <Text style={styles.sub} numberOfLines={1}>{v.sub}</Text>}
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    headingRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    },
    heading: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
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
    title: { fontSize: 14.5, color: colors.textPrimary },
    sub: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  })
}
