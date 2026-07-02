import React, { useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Platform,
  TextInput,
} from 'react-native'
import { useColors } from '@/hooks/useColors'
import { useRegions } from '@/hooks/useRegions'
import { useCompanies } from '@/hooks/useCompanies'
import { useHashtags } from '@/hooks/useHashtags'
import TopBar from '@/components/TopBar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AGE_GROUP_FILTERS } from '@/constants/ageGroups'
import { DAY_OPTIONS, TIME_SLOTS } from '@/constants/filters'
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
    regions,
    dateRange,
    maxPrice,
    hashtags,
    ageGroups,
    days,
    timeSlots,
    companies,
    recentFilters,
    toggleRegion,
    setDateRange,
    setMaxPrice,
    toggleHashtag,
    toggleAgeGroup,
    toggleDay,
    toggleTimeSlot,
    toggleCompany,
    saveRecentFilter,
    applyRecentFilter,
    resetFilters,
  } = useFilterStore()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const regionOptions = useRegions()
  const companyOptions = useCompanies()
  const hashtagOptions = useHashtags()
  const [hashtagQuery, setHashtagQuery] = useState('')

  // 검색어로 후보 필터링 + 선택된 태그는 항상 위에 노출
  const filteredHashtags = useMemo(() => {
    const q = hashtagQuery.trim().replace(/^#/, '').toLowerCase()
    const base = q
      ? hashtagOptions.filter((t) => t.replace(/^#/, '').toLowerCase().includes(q))
      : hashtagOptions
    // 선택됐지만 후보에 없는 태그(예: 검색 결과 밖)도 노출되도록 합침
    const merged = [...hashtags.filter((t) => !base.includes(t)), ...base]
    return merged
  }, [hashtagOptions, hashtagQuery, hashtags])
  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    resetText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    applyText: {
      fontSize: 14,
      color: colors.primary,
      fontWeight: '700',
    },
    section: {
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
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
    searchInput: {
      backgroundColor: colors.surfaceHigh,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 14,
      color: colors.textPrimary,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 12,
    },
    chip: {
      backgroundColor: colors.surfaceHigh,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    chipText: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    chipTextSelected: {
      color: '#fff',
      fontWeight: '700',
    },
    recentChip: {
      backgroundColor: colors.surfaceHigh,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: 8,
    },
    recentChipText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
  }), [colors, insets.top])

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
        <TopBar onBeforeNavigate={onClose} />
        {/* 헤더 */}
        <View style={styles.header}>
          <TouchableOpacity onPress={resetFilters} hitSlop={8}>
            <Text style={styles.resetText}>초기화</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>필터</Text>
          <TouchableOpacity onPress={handleApply} hitSlop={8}>
            <Text style={styles.applyText}>적용</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* 최근 필터 */}
          {recentFilters.length > 0 && (
            <Section title="최근 필터" styles={styles}>
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
                        {f.regions && f.regions.length > 0 ? f.regions.join(', ') : '전체'}
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
          <Section title="지역" styles={styles}>
            <View style={styles.chipGrid}>
              {regionOptions.map((r) => (
                <Chip
                  key={r.id}
                  label={r.label}
                  selected={regions.includes(r.id)}
                  onPress={() => toggleRegion(r.id)}
                  styles={styles}
                />
              ))}
            </View>
          </Section>

          {/* 나이대 */}
          <Section title="나이대" styles={styles}>
            <View style={styles.chipGrid}>
              {AGE_GROUP_FILTERS.map((a) => (
                <Chip
                  key={a.id}
                  label={a.label}
                  selected={ageGroups.includes(a.id)}
                  onPress={() => toggleAgeGroup(a.id)}
                  styles={styles}
                />
              ))}
            </View>
          </Section>

          {/* 해시태그 */}
          <Section title="해시태그" styles={styles}>
            <TextInput
              style={styles.searchInput}
              placeholder="해시태그 검색 (예: 와인, 30대)"
              placeholderTextColor={colors.textTertiary}
              value={hashtagQuery}
              onChangeText={setHashtagQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.chipGrid}>
              {filteredHashtags.map((t) => (
                <Chip
                  key={t}
                  label={t}
                  selected={hashtags.includes(t)}
                  onPress={() => toggleHashtag(t)}
                  styles={styles}
                />
              ))}
            </View>
          </Section>

          {/* 요일 */}
          <Section title="요일" styles={styles}>
            <View style={styles.chipRow}>
              {DAY_OPTIONS.map((d) => (
                <Chip
                  key={d.id}
                  label={d.label}
                  selected={days.includes(d.id)}
                  onPress={() => toggleDay(d.id)}
                  styles={styles}
                />
              ))}
            </View>
          </Section>

          {/* 시간대 */}
          <Section title="시간대" styles={styles}>
            <View style={styles.chipRow}>
              {TIME_SLOTS.map((t) => (
                <Chip
                  key={t.id}
                  label={t.label}
                  selected={timeSlots.includes(t.id)}
                  onPress={() => toggleTimeSlot(t.id)}
                  styles={styles}
                />
              ))}
            </View>
          </Section>

          {/* 날짜 */}
          <Section title="날짜" styles={styles}>
            <View style={styles.chipRow}>
              {DATE_RANGES.map((d) => (
                <Chip
                  key={d.id}
                  label={d.label}
                  selected={dateRange === d.id}
                  onPress={() => setDateRange(d.id)}
                  styles={styles}
                />
              ))}
            </View>
          </Section>

          {/* 가격 */}
          <Section title="최대 가격" styles={styles}>
            <View style={styles.chipRow}>
              {PRICE_OPTIONS.map((p) => (
                <Chip
                  key={String(p.value)}
                  label={p.label}
                  selected={maxPrice === p.value}
                  onPress={() => setMaxPrice(p.value)}
                  styles={styles}
                />
              ))}
            </View>
          </Section>

          {/* 업체 */}
          {companyOptions.length > 0 && (
            <Section title="업체" styles={styles}>
              <View style={styles.chipGrid}>
                {companyOptions.map((c) => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    selected={companies.includes(c.id)}
                    onPress={() => toggleCompany(c.id)}
                    styles={styles}
                  />
                ))}
              </View>
            </Section>
          )}

          <View style={{ height: insets.bottom + 24 }} />
        </ScrollView>
      </View>
    </Modal>
  )
}

function Section({
  title,
  children,
  styles,
}: {
  title: string
  children: React.ReactNode
  styles: any
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
  styles,
}: {
  label: string
  selected: boolean
  onPress: () => void
  styles: any
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
