import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFavoriteEvents, useFavorites } from '@/hooks/useFavorites'
import EventCard from '@/components/EventCard'
import { Colors } from '@/constants/colors'
import type { EventWithCompany } from '@/lib/supabase'

export default function FavoritesScreen() {
  const insets = useSafeAreaInsets()
  const { events, loading } = useFavoriteEvents()
  const { favoriteIds, toggle } = useFavorites()

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>관심 소개팅</Text>
        <Text style={styles.subtitle}>
          {loading ? '' : `${events.length}개의 소개팅을 저장했습니다`}
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : events.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>♡</Text>
          <Text style={styles.emptyText}>아직 관심 소개팅이 없습니다</Text>
          <Text style={styles.emptySubText}>이벤트 카드의 하트를 눌러 저장하세요</Text>
        </View>
      ) : (
        <FlatList
          data={events as EventWithCompany[]}
          renderItem={({ item }) => (
            <EventCard
              event={item}
              isFavorite={favoriteIds.has(item.id)}
              onToggleFavorite={() => toggle(item.id)}
            />
          )}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyIcon: { fontSize: 48, color: Colors.primary },
  emptyText: { fontSize: 16, color: Colors.textSecondary, fontWeight: '600' },
  emptySubText: { fontSize: 13, color: Colors.textTertiary },
})
