import { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  FlatList,
  ScrollView,
} from 'react-native'
import { useRouter } from 'expo-router'
import EventCard from '@/components/EventCard'
import EventCardSkeleton from '@/components/EventCardSkeleton'
import FilterSheet from '@/components/FilterSheet'
import EmptyState from '@/components/EmptyState'
import { useEvents } from '@/hooks/useEvents'
import { useFilter } from '@/hooks/useFilter'
import { Colors } from '@/constants/colors'
import { REGIONS } from '@/constants/regions'

export default function HomeScreen() {
  const { events, loading, error, refetch } = useEvents()
  const [filterVisible, setFilterVisible] = useState(false)
  const { region, setRegion, activeFilterCount } = useFilter()
  const router = useRouter()

  return (
    <View style={styles.container}>
      {/* 지역 탭 바 */}
      <View style={styles.regionBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12 }}
        >
          {REGIONS.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.regionTab,
                region === item.id && styles.regionTabActive,
              ]}
              onPress={() => setRegion(item.id)}
            >
              <Text
                style={[
                  styles.regionTabText,
                  region === item.id && styles.regionTabTextActive,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* 필터 + 설정 버튼 행 */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.filterBtn}
          onPress={() => setFilterVisible(true)}
        >
          <Text style={styles.filterBtnText}>
            🔧 필터{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => router.push('/alerts')}
        >
          <Text style={styles.iconBtnText}>🔔</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => router.push('/settings')}
        >
          <Text style={styles.iconBtnText}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* 에러 */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>오류: {error}</Text>
          <TouchableOpacity onPress={refetch}>
            <Text style={styles.retryText}>재시도</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 이벤트 리스트 */}
      {loading ? (
        <View style={styles.skeletonList}>
          {[1, 2, 3].map((i) => (
            <EventCardSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlatList
          data={events}
          renderItem={({ item }) => <EventCard event={item} />}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={refetch}
              tintColor={Colors.primary}
            />
          }
          ListEmptyComponent={<EmptyState />}
          contentContainerStyle={{ paddingVertical: 8 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      <FilterSheet
        visible={filterVisible}
        onClose={() => setFilterVisible(false)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  regionBar: {
    height: 48,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  regionTab: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 2,
  },
  regionTabActive: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.primary,
  },
  regionTabText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  regionTabTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  filterBtn: {
    flex: 1,
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  filterBtnText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  iconBtn: {
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  iconBtnText: {
    fontSize: 16,
  },
  errorBanner: {
    backgroundColor: Colors.error,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorText: {
    color: '#fff',
    fontSize: 13,
  },
  retryText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  skeletonList: {
    flex: 1,
  },
})
