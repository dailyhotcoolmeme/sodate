import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { View, Text, StyleSheet, FlatList, ScrollView, TouchableOpacity, RefreshControl, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import BottomNav from '@/components/BottomNav'
import PlaceListItem from '@/components/PlaceListItem'
import AppSpinner from '@/components/AppSpinner'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { fetchPlaces, type PlaceRow } from '@/lib/places'

/**
 * 혼술바 탭 — 혼자 술 마시기 좋은 바를 종류·지역으로 찾는다(2026-08-22).
 * 이벤트가 아니라 상시 매장(places 테이블). 헤더는 소개팅과 같은 문법(종류 + 지역 2줄).
 * 혼술친화·조용·심야 등은 카드에 해시태그로 표시한다(오너 지시). 지도 토글은 카카오맵(키·재빌드 후).
 *
 * ⚠️ NEW_TABS_ENABLED 가 false 인 동안은 이 화면으로 올 길이 없다.
 * (파일럿) 현재는 전부 불러와 클라이언트에서 거른다 — 618곳으로 늘면 서버 필터로 전환.
 */
export default function HonsulScreen() {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [all, setAll] = useState<PlaceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [cat, setCat] = useState<string | null>(null)      // 종류(단일)
  const [region, setRegion] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setAll(await fetchPlaces()) } catch (e) { /* 조용히 */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false) }, [load])

  const categories = useMemo(() => Array.from(new Set(all.map((p) => p.category).filter(Boolean))) as string[], [all])
  const regions = useMemo(() => Array.from(new Set(all.map((p) => p.region).filter(Boolean))) as string[], [all])

  const list = useMemo(() => all.filter((p) =>
    (!cat || p.category === cat) && (!region || p.region === region)
  ), [all, cat, region])

  return (
    <View style={styles.container}>
      <TopBar onSearchPress={() => {}} />

      {/* 종류 (맨 윗줄만 위 여백) — 소개팅 지역/나이대 칩과 동일 리듬 */}
      <View style={[styles.chipScroll, styles.chipScrollTop]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip label="전체" active={cat === null} onPress={() => setCat(null)} colors={colors} />
          {categories.map((c) => <Chip key={c} label={c} active={cat === c} onPress={() => setCat(cat === c ? null : c)} colors={colors} />)}
        </ScrollView>
      </View>

      {/* 지역 + 리스트/지도 토글 */}
      <View style={styles.regionScroll}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={{ flex: 1 }}>
          <Chip label="전체" active={region === null} onPress={() => setRegion(null)} colors={colors} />
          {regions.map((r) => <Chip key={r} label={r} active={region === r} onPress={() => setRegion(region === r ? null : r)} colors={colors} />)}
        </ScrollView>
        <View style={styles.viewToggle}>
          <View style={[styles.viewBtn, styles.viewBtnActive]}><Ionicons name="list-outline" size={18} color={colors.textPrimary} /></View>
          <TouchableOpacity style={styles.viewBtn} onPress={() => Alert.alert('지도 준비 중', '카카오맵 연동 후 열려요.')}>
            <Ionicons name="map-outline" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.countRow}><Text style={styles.countText}>{list.length}곳</Text></View>

      {loading ? (
        <View style={styles.center}><AppSpinner /></View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="wine-outline" size={34} color={colors.textTertiary} />
          <Text style={styles.emptyText}>조건에 맞는 혼술바가 없어요</Text>
          <Text style={styles.emptySub}>필터를 바꿔보세요</Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <PlaceListItem place={item} />}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: insets.bottom + 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      <BottomNav current="honsul" />
    </View>
  )
}

function Chip({ label, active, onPress, colors }: { label: string; active: boolean; onPress: () => void; colors: AppColors }) {
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipOn]} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    // 소개팅과 동일: 칩 줄 height 34 + marginBottom 2, 맨 윗줄만 marginTop 6.
    chipScroll: { height: 34, marginBottom: 2, justifyContent: 'center' },
    chipScrollTop: { marginTop: 6 },
    regionScroll: { height: 34, marginBottom: 2, flexDirection: 'row', alignItems: 'center' },
    chipRow: { paddingHorizontal: 16, alignItems: 'center', gap: 6 },
    chip: { paddingHorizontal: 13, paddingVertical: 5, borderRadius: 18, backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.border },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
    chipTextOn: { color: '#fff', fontWeight: '700' },
    viewToggle: { flexDirection: 'row', gap: 2, marginLeft: 6, marginRight: 4 },
    viewBtn: { width: 30, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
    viewBtnActive: { backgroundColor: colors.surfaceHigh },
    countRow: { paddingHorizontal: 16, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.divider },
    countText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 60 },
    emptyText: { fontSize: 15, color: colors.textSecondary, marginTop: 4 },
    emptySub: { fontSize: 13, color: colors.textTertiary },
  })
}
