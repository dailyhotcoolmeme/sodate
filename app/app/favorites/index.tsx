import React, { useState, useMemo } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFavoriteEvents, useFavorites } from '@/hooks/useFavorites'
import EventCard from '@/components/EventCard'
import EventListItem from '@/components/EventListItem'
import { useColors } from '@/hooks/useColors'
import type { EventWithCompany } from '@/lib/supabase'
import { track } from '@/lib/analytics'

type ViewMode = 'card' | 'list'

export default function FavoritesScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { events, loading } = useFavoriteEvents()
  const { favoriteIds, toggle } = useFavorites()

  React.useEffect(() => { track('screen_view', { properties: { screen: 'favorites' } }) }, [])
  const [viewMode, setViewMode] = useState<ViewMode>('card')
  const colors = useColors()
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: 16, paddingBottom: 12 },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 8,
      marginBottom: 8,
    },
    backBtn: { paddingVertical: 4, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 2 },
    backText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
    toggleRow: { flexDirection: 'row', gap: 2 },
    viewBtn: {
      width: 30,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 6,
    },
    viewBtnActive: { backgroundColor: colors.surfaceHigh },
    viewBtnText: { fontSize: 16, color: colors.textTertiary },
    viewBtnTextActive: { color: colors.textPrimary },
    title: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
    subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    emptyIcon: { fontSize: 48, color: colors.primary },
    emptyText: { fontSize: 16, color: colors.textSecondary, fontWeight: '600' },
    emptySubText: { fontSize: 13, color: colors.textTertiary },
  }), [colors])

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={16} color={colors.primary} /><Text style={styles.backText}>홈</Text>
          </TouchableOpacity>
          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[styles.viewBtn, viewMode === 'card' && styles.viewBtnActive]}
              onPress={() => setViewMode('card')}
            >
              <Ionicons name="grid-outline" size={18} color={viewMode === 'card' ? colors.textPrimary : colors.textTertiary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.viewBtn, viewMode === 'list' && styles.viewBtnActive]}
              onPress={() => setViewMode('list')}
            >
              <Ionicons name="list-outline" size={18} color={viewMode === 'list' ? colors.textPrimary : colors.textTertiary} />
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.title}>관심 소개팅</Text>
        <Text style={styles.subtitle}>
          {loading ? '' : `${events.length}개의 소개팅을 저장했습니다`}
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : events.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="heart-outline" size={48} color={colors.primary} />
          <Text style={styles.emptyText}>아직 관심 소개팅이 없습니다</Text>
          <Text style={styles.emptySubText}>이벤트 카드의 하트를 눌러 저장하세요</Text>
        </View>
      ) : (
        <FlatList
          data={events as EventWithCompany[]}
          renderItem={({ item }) =>
            viewMode === 'card' ? (
              <EventCard
                event={item}
                isFavorite={favoriteIds.has(item.id)}
                onToggleFavorite={() => toggle(item.id)}
              />
            ) : (
              <EventListItem
                event={item}
                isFavorite={favoriteIds.has(item.id)}
                onToggleFavorite={() => toggle(item.id)}
              />
            )
          }
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  )
}
