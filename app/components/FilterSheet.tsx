import React, { useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
} from 'react-native'
import { useColors } from '@/hooks/useColors'
import { useRegions } from '@/hooks/useRegions'
import { REGION_GROUP_ORDER, regionGroupKey, TAG_GROUP_ORDER, tagGroupKey } from '@/constants/chipGroups'
import { useCompanies } from '@/hooks/useCompanies'
import { useHashtags } from '@/hooks/useHashtags'
import TopBar from '@/components/TopBar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AGE_GROUP_FILTERS } from '@/constants/ageGroups'
import { DAY_OPTIONS, TIME_SLOTS } from '@/constants/filters'
import { useFilterStore, type FilterSnapshot } from '@/stores/filterStore'
import { useCollapseStore } from '@/stores/collapseStore'
import CollapsibleSection from '@/components/CollapsibleSection'
import DateRangeCalendar from '@/components/DateRangeCalendar'

interface Props {
  visible: boolean
  onClose: () => void
}

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
    dateStart,
    dateEnd,
    maxPrice,
    hashtags,
    ageGroups,
    days,
    timeSlots,
    companies,
    recentFilters,
    toggleRegion,
    setRegionsBulk,
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

  // 섹션별 접기·펼치기 — 기기에 저장돼 다음에 열어도 마지막 상태 유지(오너 지시 2026-08-12).
  const sectionExpanded = useCollapseStore((s) => s.expanded)
  const toggleSection = useCollapseStore((s) => s.toggle)
  const setManyExpanded = useCollapseStore((s) => s.setMany)
  const sectionKeys = useMemo(() => {
    const keys = ['region', 'age', 'hashtag', 'day', 'time', 'date', 'price']
    if (companyOptions.length > 0) keys.push('company')
    return keys.map((k) => `filter:${k}`)
  }, [companyOptions.length])
  const allExpanded = sectionKeys.length > 0 && sectionKeys.every((k) => sectionExpanded[k])
  const toggleAllSections = () => setManyExpanded(sectionKeys, !allExpanded)

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

  // 지역/태그 칩을 '군(群)'으로 묶어 표시(알림 설정과 동일 규칙)
  const groupedRegions = useMemo(() => {
    const buckets: Record<string, typeof regionOptions> = {}
    for (const r of regionOptions) (buckets[regionGroupKey(r.label)] ??= []).push(r)
    return REGION_GROUP_ORDER.filter((g) => buckets[g.key]?.length).map((g) => ({ ...g, items: buckets[g.key] }))
  }, [regionOptions])

  const groupedHashtags = useMemo(() => {
    const buckets: Record<string, string[]> = {}
    for (const t of filteredHashtags) (buckets[tagGroupKey(t)] ??= []).push(t)
    return TAG_GROUP_ORDER.filter((k) => buckets[k]?.length).map((k) => ({ key: k, items: buckets[k] }))
  }, [filteredHashtags])

  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
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
    toggleAllRow: {
      alignItems: 'flex-end',
      paddingTop: 12,
      paddingBottom: 4,
    },
    toggleAllText: { fontSize: 13, fontWeight: '700', color: colors.primary },
    applyBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: 10,
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    barBtn: {
      flex: 1,                 // 초기화·적용하기 동일 너비
      borderRadius: 14,
      paddingVertical: 15,
      alignItems: 'center',
      justifyContent: 'center',
    },
    resetBtn: {
      backgroundColor: colors.surfaceHigh,
      borderWidth: 1,
      borderColor: colors.border,
    },
    resetBtnText: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '700',
    },
    applyFab: {
      backgroundColor: colors.primary,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    applyFabText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '800',
    },
    section: {
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    sectionLast: {
      borderBottomWidth: 0,
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
    groupTop: { fontSize: 14, fontWeight: '800', color: colors.textPrimary, marginTop: 12, marginBottom: 2 },
    groupRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 8, gap: 8 },
    groupRowLabel: { width: 60, paddingLeft: 10, paddingTop: 7, fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    groupRowLabelTop: { width: 60, paddingTop: 6, fontSize: 14, fontWeight: '800', color: colors.textPrimary },
    // 지역 군 라벨(강남권 등)을 누르면 그 안의 칩이 한번에 선택된다(알림 설정과 동일, 2026-08-02 오너 지시).
    groupRowLabelActive: { color: colors.primary },
    groupRowChips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 6,
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
        {/* pageSheet 모달은 이미 상태바 아래에서 시작한다. 여기서 안전영역 여백을
            또 주면 홈 화면보다 한참 아래에서 시작해 보인다(2026-07-31 오너 지적). */}
        <TopBar onBeforeNavigate={onClose} noSafeTop />
        {/* 헤더 — 초기화·적용은 하단 플로팅으로 이동 */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>필터</Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 96 }}>
          {/* 전체 접기/펼치기 — 섹션이 많아 리스트가 길어지는 걸 완화(오너 지시 2026-08-12) */}
          <View style={styles.toggleAllRow}>
            <TouchableOpacity onPress={toggleAllSections} hitSlop={8}>
              <Text style={styles.toggleAllText}>{allExpanded ? '전체 접기' : '전체 펼치기'}</Text>
            </TouchableOpacity>
          </View>

          {/* 최근 필터 — 가로 스크롤 한 줄이라 접기 대상에서 제외 */}
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
                        {f.dateStart && f.dateEnd
                          ? ` · ${f.dateStart.slice(5).replace('-', '.')}~${f.dateEnd.slice(5).replace('-', '.')}`
                          : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </Section>
          )}

          {/* 지역 */}
          <CollapsibleSection
            title="지역"
            expanded={!!sectionExpanded['filter:region']}
            onToggle={() => toggleSection('filter:region')}
          >
            {groupedRegions.map((g, gi) => {
              const showParent = !!g.parent && (gi === 0 || groupedRegions[gi - 1].parent !== g.parent)
              const groupIds = g.items.map((r) => r.id)
              const groupAllOn = groupIds.length > 0 && groupIds.every((id) => regions.includes(id))
              return (
                <View key={g.key}>
                  {showParent && <Text style={styles.groupTop}>{g.parent}</Text>}
                  <View style={styles.groupRow}>
                    <TouchableOpacity onPress={() => setRegionsBulk(groupIds, !groupAllOn)} hitSlop={6}>
                      <Text style={[g.parent ? styles.groupRowLabel : styles.groupRowLabelTop, groupAllOn && styles.groupRowLabelActive]}>
                        {g.key}
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.groupRowChips}>
                      {g.items.map((r) => (
                        <Chip
                          key={r.id}
                          label={r.label}
                          selected={regions.includes(r.id)}
                          onPress={() => toggleRegion(r.id)}
                          styles={styles}
                        />
                      ))}
                    </View>
                  </View>
                </View>
              )
            })}
          </CollapsibleSection>

          {/* 나이대 */}
          <CollapsibleSection
            title="나이대"
            expanded={!!sectionExpanded['filter:age']}
            onToggle={() => toggleSection('filter:age')}
          >
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
          </CollapsibleSection>

          {/* 해시태그 */}
          <CollapsibleSection
            title="해시태그"
            expanded={!!sectionExpanded['filter:hashtag']}
            onToggle={() => toggleSection('filter:hashtag')}
          >
            <TextInput
              style={styles.searchInput}
              placeholder="해시태그 검색 (예: 와인, 30대)"
              placeholderTextColor={colors.textTertiary}
              value={hashtagQuery}
              onChangeText={setHashtagQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {groupedHashtags.map((g) => (
              <View key={g.key} style={styles.groupRow}>
                <Text style={styles.groupRowLabelTop}>{g.key}</Text>
                <View style={styles.groupRowChips}>
                  {g.items.map((t) => (
                    <Chip
                      key={t}
                      label={t}
                      selected={hashtags.includes(t)}
                      onPress={() => toggleHashtag(t)}
                      styles={styles}
                    />
                  ))}
                </View>
              </View>
            ))}
          </CollapsibleSection>

          {/* 요일 */}
          <CollapsibleSection
            title="요일"
            expanded={!!sectionExpanded['filter:day']}
            onToggle={() => toggleSection('filter:day')}
          >
            <View style={styles.chipGrid}>
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
          </CollapsibleSection>

          {/* 시간대 */}
          <CollapsibleSection
            title="시간"
            expanded={!!sectionExpanded['filter:time']}
            onToggle={() => toggleSection('filter:time')}
          >
            <View style={styles.chipGrid}>
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
          </CollapsibleSection>

          {/* 기간 */}
          <CollapsibleSection
            title="기간"
            expanded={!!sectionExpanded['filter:date']}
            onToggle={() => toggleSection('filter:date')}
          >
            <DateRangeCalendar
              startDate={dateStart}
              endDate={dateEnd}
              onChange={(s, e) => setDateRange(s, e)}
            />
          </CollapsibleSection>

          {/* 가격 */}
          <CollapsibleSection
            title="가격"
            expanded={!!sectionExpanded['filter:price']}
            onToggle={() => toggleSection('filter:price')}
          >
            <View style={styles.chipGrid}>
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
          </CollapsibleSection>

          {/* 업체 */}
          {companyOptions.length > 0 && (
            <CollapsibleSection
              title="업체"
              expanded={!!sectionExpanded['filter:company']}
              onToggle={() => toggleSection('filter:company')}
              last
            >
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
            </CollapsibleSection>
          )}

          <View style={{ height: insets.bottom + 24 }} />
        </ScrollView>

        {/* 하단 플로팅 바 — 초기화 · 적용하기 한 줄, 동일 너비 */}
        <View style={[styles.applyBar, { paddingBottom: insets.bottom + 10 }]}>
          <TouchableOpacity style={[styles.barBtn, styles.resetBtn]} onPress={resetFilters} activeOpacity={0.85}>
            <Text style={styles.resetBtnText}>초기화</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.barBtn, styles.applyFab]} onPress={handleApply} activeOpacity={0.85}>
            <Text style={styles.applyFabText}>적용하기</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

function Section({
  title,
  children,
  styles,
  last = false,
}: {
  title?: string
  children: React.ReactNode
  styles: any
  /** 맨 아래 묶음이면 구분선을 그리지 않는다 */
  last?: boolean
}) {
  return (
    <View style={[styles.section, last && styles.sectionLast]}>
      {!!title && <Text style={styles.sectionTitle}>{title}</Text>}
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
