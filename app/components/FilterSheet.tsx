import React from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Platform,
} from 'react-native'
import { Colors } from '@/constants/colors'
import { REGIONS } from '@/constants/regions'
import { THEMES } from '@/constants/themes'
import { useFilterStore, type FilterSnapshot } from '@/stores/filterStore'

interface Props {
  visible: boolean
  onClose: () => void
}

const DATE_RANGES: { id: 'all' | 'today' | 'week' | 'month'; label: string }[] =
  [
    { id: 'all', label: '전체' },
    { id: 'today', label: '오늘' },
    { id: 'week', label: '1주일' },
    { id: 'month', label: '1달' },
  ]

const PRICE_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: '제한 없음' },
  { value: 30000, label: '3만원 이하' },
  { value: 50000, label: '5만원 이하' },
  { value: 80000, label: '8만원 이하' },
  { value: 100000, label: '10만원 이하' },
]

export default function FilterSheet({ visible, onClose }: Props) {
  const {
    region,
    dateRange,
    maxPrice,
    themes,
    recentFilters,
    setRegion,
    setDateRange,
    setMaxPrice,
    toggleTheme,
    saveRecentFilter,
    applyRecentFilter,
    resetFilters,
  } = useFilterStore()

  const handleApply = () => {
    saveRecentFilter()
    onClose()
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* 헤더 */}
        <View style={styles.header}>
          <TouchableOpacity onPress={resetFilters}>
            <Text style={styles.resetText}>초기화</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>필터</Text>
          <TouchableOpacity onPress={handleApply}>
            <Text style={styles.applyText}>적용</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* 최근 필터 */}
          {recentFilters.length > 0 && (
            <Section title="최근 필터">
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chipRow}>
                  {recentFilters.map((f: FilterSnapshot) => (
                    <TouchableOpacity
                      key={f.id}
                      style={styles.recentChip}
                      onPress={() => {
                        applyRecentFilter(f)
                        onClose()
                      }}
                    >
                      <Text style={styles.recentChipText}>
                        {f.region !== 'all' ? f.region : '전체'}
                        {f.themes.length > 0 ? ` · ${f.themes[0]}` : ''}
                        {f.dateRange !== 'all'
                          ? ` · ${f.dateRange === 'today' ? '오늘' : f.dateRange === 'week' ? '1주일' : '1달'}`
                          : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </Section>
          )}

          {/* 지역 */}
          <Section title="지역">
            <View style={styles.chipGrid}>
              {REGIONS.map((r) => (
                <Chip
                  key={r.id}
                  label={r.label}
                  selected={region === r.id}
                  onPress={() => setRegion(r.id)}
                />
              ))}
            </View>
          </Section>

          {/* 날짜 */}
          <Section title="날짜">
            <View style={styles.chipRow}>
              {DATE_RANGES.map((d) => (
                <Chip
                  key={d.id}
                  label={d.label}
                  selected={dateRange === d.id}
                  onPress={() => setDateRange(d.id)}
                />
              ))}
            </View>
          </Section>

          {/* 테마 */}
          <Section title="테마">
            <View style={styles.chipGrid}>
              {THEMES.map((t) => (
                <Chip
                  key={t.id}
                  label={t.label}
                  selected={themes.includes(t.id)}
                  onPress={() => toggleTheme(t.id)}
                />
              ))}
            </View>
          </Section>

          {/* 가격 */}
          <Section title="최대 가격">
            <View style={styles.chipRow}>
              {PRICE_OPTIONS.map((p) => (
                <Chip
                  key={String(p.value)}
                  label={p.label}
                  selected={maxPrice === p.value}
                  onPress={() => setMaxPrice(p.value)}
                />
              ))}
            </View>
          </Section>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string
  selected: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingTop: Platform.OS === 'android' ? 16 : 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  resetText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  applyText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '700',
  },
  section: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  chipGrid: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  chip: {
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: '#fff',
    fontWeight: '700',
  },
  recentChip: {
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 8,
  },
  recentChipText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
})
