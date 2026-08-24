import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, FlatList } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import AppSpinner from '@/components/AppSpinner'
import PlaceListItem from '@/components/PlaceListItem'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { fetchPlaces, type PlaceRow } from '@/lib/places'
import { usePlaceFavorites } from '@/stores/placeFavoriteStore'

/** 관심 매장(혼술바 찜) 목록 — MY '관심 매장'에서 진입. */
export default function PlaceFavoritesScreen() {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { favoriteIds, toggle } = usePlaceFavorites()
  const [all, setAll] = useState<PlaceRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetchPlaces().then((p) => { if (alive) { setAll(p); setLoading(false) } }).catch(() => setLoading(false))
    return () => { alive = false }
  }, [])

  const list = useMemo(() => all.filter((p) => favoriteIds.has(p.id)), [all, favoriteIds])

  return (
    <View style={styles.container}>
      <TopBar showBack title="관심 혼술바" />
      {loading ? (
        <View style={styles.center}><AppSpinner /></View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="wine-outline" size={38} color={colors.textTertiary} />
          <Text style={styles.emptyText}>찜한 혼술바가 없어요</Text>
          <Text style={styles.emptySub}>마음에 드는 혼술바에 하트를 눌러보세요</Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <PlaceListItem place={item} isFavorite onToggleFavorite={() => toggle(item.id)} />
          )}
          contentContainerStyle={{ paddingTop: 6, paddingBottom: insets.bottom + 16 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: 16, paddingBottom: 10 },
    title: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
    emptyText: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    emptySub: { fontSize: 13, color: colors.textTertiary, textAlign: 'center' },
  })
}
