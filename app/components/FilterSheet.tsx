import React, { useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  Platform,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useColors } from '@/hooks/useColors'
import { useRegions } from '@/hooks/useRegions'
import { REGION_GROUP_ORDER, regionGroupKey, TAG_GROUP_ORDER, tagGroupKey } from '@/constants/chipGroups'
import { useCompanies } from '@/hooks/useCompanies'
import { useHashtags } from '@/hooks/useHashtags'
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

/** 가격 직접 입력 — 숫자만 남기고, 비었으면 null(제한 없음)로. */
function parsePriceInput(text: string): number | null {
  const digits = text.replace(/[^0-9]/g, '')
  return digits ? Number(digits) : null
}

// FilterSheet가 실제로 편집하는 필드들의 초안(draft) 타입 — 나머지(정렬 등)는 스토어를 안 거친다.
type FilterDraft = {
  regions: string[]
  dateStart: string | null
  dateEnd: string | null
  minPrice: number | null
  maxPrice: number | null
  hashtags: string[]
  ageGroups: string[]
  days: number[]
  timeSlots: string[]
  companies: string[]
}

function draftFromStore(s: ReturnType<typeof useFilterStore.getState>): FilterDraft {
  return {
    regions: s.regions,
    dateStart: s.dateStart,
    dateEnd: s.dateEnd,
    minPrice: s.minPrice,
    maxPrice: s.maxPrice,
    hashtags: s.hashtags,
    ageGroups: s.ageGroups,
    days: s.days,
    timeSlots: s.timeSlots,
    companies: s.companies,
  }
}

export default function FilterSheet({ visible, onClose }: Props) {
  const { recentFilters, saveRecentFilter, applyRecentFilter, resetFilters, applyDraft } = useFilterStore()

  // ⚠️(2026-08-13, 오너 지적: 필터 시트 진입 시 한번씩 멈춤) 예전엔 칩을 누를 때마다
  // 스토어를 바로 커밋했고, useEvents가 그 스토어를 구독해 칩 하나 누를 때마다 네트워크
  // 요청을 새로 쐈다. 시트를 열어두고 칩을 여러 개 빠르게 누르면 그만큼 요청이 겹쳐
  // 나갔고, 그중 하나라도 느려지면(iOS 셀룰러에서 흔함) UI가 멈춘 것처럼 보였다.
  // 이제 시트 안에서는 이 로컬 draft만 바꾸고, "적용하기"를 눌렀을 때만 스토어에 커밋한다
  // (그래야 진짜로 네트워크 요청도 그때 딱 한 번만 나간다). 시트를 열 때마다 스토어의
  // 현재 값으로 draft를 다시 채운다 — 적용 없이 닫으면(스와이프·뒤로가기) 자동으로 취소됨.
  const [draft, setDraft] = useState<FilterDraft>(() => draftFromStore(useFilterStore.getState()))
  useEffect(() => {
    if (visible) setDraft(draftFromStore(useFilterStore.getState()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const { regions, dateStart, dateEnd, minPrice, maxPrice, hashtags, ageGroups, days, timeSlots, companies } = draft

  const toggleRegion = (id: string) =>
    setDraft((d) => ({
      ...d,
      regions: d.regions.includes(id) ? d.regions.filter((x) => x !== id) : [...d.regions, id],
    }))
  const setRegionsBulk = (ids: string[], on: boolean) =>
    setDraft((d) => ({
      ...d,
      regions: on ? Array.from(new Set([...d.regions, ...ids])) : d.regions.filter((x) => !ids.includes(x)),
    }))
  const setDateRange = (s: string | null, e: string | null) => setDraft((d) => ({ ...d, dateStart: s, dateEnd: e }))
  const setMinPrice = (p: number | null) => setDraft((d) => ({ ...d, minPrice: p }))
  const setMaxPrice = (p: number | null) => setDraft((d) => ({ ...d, maxPrice: p }))
  const toggleHashtag = (tag: string) =>
    setDraft((d) => ({
      ...d,
      hashtags: d.hashtags.includes(tag) ? d.hashtags.filter((t) => t !== tag) : [...d.hashtags, tag],
    }))
  const toggleAgeGroup = (id: string) =>
    setDraft((d) => ({
      ...d,
      ageGroups: d.ageGroups.includes(id) ? d.ageGroups.filter((x) => x !== id) : [...d.ageGroups, id],
    }))
  const toggleDay = (day: number) =>
    setDraft((d) => ({ ...d, days: d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day] }))
  const toggleTimeSlot = (slot: string) =>
    setDraft((d) => ({
      ...d,
      timeSlots: d.timeSlots.includes(slot) ? d.timeSlots.filter((x) => x !== slot) : [...d.timeSlots, slot],
    }))
  const toggleCompany = (id: string) =>
    setDraft((d) => ({
      ...d,
      companies: d.companies.includes(id) ? d.companies.filter((x) => x !== id) : [...d.companies, id],
    }))

  const colors = useColors()
  const insets = useSafeAreaInsets()
  const regionOptions = useRegions('dating')
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
    // 헤더 — MY "알림 설정" 페이지(TopBar showBack+title)와 동일 규격. 모달이라
    // 뒤로가기가 router.back() 이 아니라 onClose 라 TopBar 대신 직접 그린다.
    // Android 는 pageSheet 가 상태바를 안 피해가므로 안전영역을 더해야 한다(iOS는 이미 아래에서 시작).
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingTop: Platform.OS === 'android' ? insets.top + 10 : 10,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    topLeft: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    topBack: { paddingRight: 2 },
    topTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.3 },
    topReset: { fontSize: 14, fontWeight: '700', color: colors.textTertiary },
    toggleAllRow: {
      alignItems: 'flex-end',
      paddingTop: 12,
      paddingBottom: 4,
    },
    toggleAllText: { fontSize: 13, fontWeight: '700', color: colors.primary },
    // 하단 바 — 초기화는 상단으로 옮겼으니 적용하기 하나만 전체 너비로 남는다.
    // 그림자 없앰(오너 지시 2026-08-24) — 알림 설정 "저장" 버튼과 동일하게 flat.
    applyBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: 16,
      paddingTop: 10,
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    applyFab: {
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    applyFabText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
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
    priceRangeLabel: { fontSize: 12, fontWeight: '600', color: colors.textTertiary, marginTop: 14, marginBottom: 8 },
    priceRangeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    priceInput: {
      flex: 1, minWidth: 0, backgroundColor: colors.surfaceHigh, borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.textPrimary,
      borderWidth: 1, borderColor: colors.border,
    },
    priceRangeDash: { fontSize: 14, color: colors.textTertiary },
    priceRangeUnit: { fontSize: 13, color: colors.textSecondary },
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
    applyDraft(draft)
    saveRecentFilter()
    onClose()
  }

  const handleReset = () => {
    resetFilters()
    setDraft({
      regions: [], dateStart: null, dateEnd: null, minPrice: null, maxPrice: null,
      hashtags: [], ageGroups: [], days: [], timeSlots: [], companies: [],
    })
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* 헤더 — MY "알림 설정"과 동일하게 뒤로가기+인라인 제목. 초기화는 여기 오른쪽으로
            옮겼다(예전엔 하단 플로팅 버튼이었음, 2026-08-24 오너 지시). */}
        <View style={styles.topRow}>
          <View style={styles.topLeft}>
            <TouchableOpacity onPress={onClose} style={styles.topBack} hitSlop={8}>
              <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.topTitle}>필터</Text>
          </View>
          <TouchableOpacity onPress={handleReset} hitSlop={8}>
            <Text style={styles.topReset}>초기화</Text>
          </TouchableOpacity>
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
            {/* 직접 입력(2026-08-24 오너 지시) — 프리셋과 별개로 최소·최대를 직접 정한다. */}
            <Text style={styles.priceRangeLabel}>직접 입력</Text>
            <View style={styles.priceRangeRow}>
              <TextInput
                style={styles.priceInput}
                placeholder="최소"
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
                value={minPrice != null ? String(minPrice) : ''}
                onChangeText={(t) => setMinPrice(parsePriceInput(t))}
              />
              <Text style={styles.priceRangeDash}>~</Text>
              <TextInput
                style={styles.priceInput}
                placeholder="최대"
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
                value={maxPrice != null ? String(maxPrice) : ''}
                onChangeText={(t) => setMaxPrice(parsePriceInput(t))}
              />
              <Text style={styles.priceRangeUnit}>원</Text>
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

        {/* 하단 플로팅 바 — 적용하기만 전체 너비로(초기화는 상단으로 옮김) */}
        <View style={[styles.applyBar, { paddingBottom: insets.bottom + 10 }]}>
          <TouchableOpacity style={styles.applyFab} onPress={handleApply} activeOpacity={0.85}>
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
