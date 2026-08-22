import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal } from 'react-native'
import { useColors } from '@/hooks/useColors'
import { useRegions } from '@/hooks/useRegions'
import { REGION_GROUP_ORDER, regionGroupKey } from '@/constants/chipGroups'
import TopBar from '@/components/TopBar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DAY_OPTIONS } from '@/constants/filters'
import { SOCIALING_GROUPS } from '@/constants/socialingCategories'
import { useSocialingFilterStore } from '@/stores/socialingFilterStore'
import CollapsibleSection from '@/components/CollapsibleSection'
import { useCollapseStore } from '@/stores/collapseStore'

interface Props {
  visible: boolean
  onClose: () => void
}

// 소셜링 가격 폭이 넓다(무료~24만원, 동행 장기클럽). 무료 구간을 따로 둔다.
const PRICE_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: '제한 없음' },
  { value: 0, label: '무료' },
  { value: 30000, label: '3만원 이하' },
  { value: 50000, label: '5만원 이하' },
  { value: 100000, label: '10만원 이하' },
]

type Draft = { groups: string[]; regions: string[]; maxPrice: number | null; days: number[] }

function draftFromStore(): Draft {
  const s = useSocialingFilterStore.getState()
  return { groups: s.groups, regions: s.regions, maxPrice: s.maxPrice, days: s.days }
}

/**
 * 소셜링 상세 필터(2026-08-22). 소개팅 FilterSheet 재사용 대신 소셜링용 항목만 담은 전용 시트:
 * 카테고리·지역·가격·요일. 나이대·성비·테마·업체·해시태그는 소셜링에 없어 뺀다.
 * 소개팅과 동일한 draft 패턴 — 칩은 로컬 draft만 바꾸고 "적용하기"에서 한 번만 커밋.
 */
export default function SocialingFilterSheet({ visible, onClose }: Props) {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const regionOptions = useRegions()
  const { applyDraft, resetFilters } = useSocialingFilterStore()

  const [draft, setDraft] = useState<Draft>(() => draftFromStore())
  useEffect(() => {
    if (visible) setDraft(draftFromStore())
  }, [visible])

  const { groups, regions, maxPrice, days } = draft
  const toggleGroup = (key: string) =>
    setDraft((d) => ({ ...d, groups: d.groups.includes(key) ? d.groups.filter((x) => x !== key) : [...d.groups, key] }))
  const toggleRegion = (id: string) =>
    setDraft((d) => ({ ...d, regions: d.regions.includes(id) ? d.regions.filter((x) => x !== id) : [...d.regions, id] }))
  const setRegionsBulk = (ids: string[], on: boolean) =>
    setDraft((d) => ({ ...d, regions: on ? Array.from(new Set([...d.regions, ...ids])) : d.regions.filter((x) => !ids.includes(x)) }))
  const setMaxPrice = (p: number | null) => setDraft((d) => ({ ...d, maxPrice: p }))
  const toggleDay = (day: number) =>
    setDraft((d) => ({ ...d, days: d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day] }))

  const sectionExpanded = useCollapseStore((s) => s.expanded)
  const toggleSection = useCollapseStore((s) => s.toggle)

  const groupedRegions = useMemo(() => {
    const buckets: Record<string, typeof regionOptions> = {}
    for (const r of regionOptions) (buckets[regionGroupKey(r.label)] ??= []).push(r)
    return REGION_GROUP_ORDER.filter((g) => buckets[g.key]?.length).map((g) => ({ ...g, items: buckets[g.key] }))
  }, [regionOptions])

  const styles = useMemo(() => makeStyles(colors, insets.bottom), [colors, insets.bottom])

  const handleApply = () => { applyDraft(draft); onClose() }
  const handleReset = () => { resetFilters(); setDraft({ groups: [], regions: [], maxPrice: null, days: [] }) }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <TopBar onBeforeNavigate={onClose} noSafeTop />
        <View style={styles.header}><Text style={styles.headerTitle}>필터</Text></View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 96 }}>
          {/* 카테고리 */}
          <CollapsibleSection title="카테고리" expanded={sectionExpanded['socfilter:cat'] !== false} onToggle={() => toggleSection('socfilter:cat')}>
            <View style={styles.chipGrid}>
              {SOCIALING_GROUPS.map((g) => (
                <Chip key={g.key} label={g.label} selected={groups.includes(g.key)} onPress={() => toggleGroup(g.key)} styles={styles} />
              ))}
            </View>
          </CollapsibleSection>

          {/* 지역 */}
          <CollapsibleSection title="지역" expanded={sectionExpanded['socfilter:region'] !== false} onToggle={() => toggleSection('socfilter:region')}>
            {groupedRegions.map((g, gi) => {
              const showParent = !!g.parent && (gi === 0 || groupedRegions[gi - 1].parent !== g.parent)
              const groupIds = g.items.map((r) => r.id)
              const groupAllOn = groupIds.length > 0 && groupIds.every((id) => regions.includes(id))
              return (
                <View key={g.key}>
                  {showParent && <Text style={styles.groupTop}>{g.parent}</Text>}
                  <View style={styles.groupRow}>
                    <TouchableOpacity onPress={() => setRegionsBulk(groupIds, !groupAllOn)} hitSlop={6}>
                      <Text style={[g.parent ? styles.groupRowLabel : styles.groupRowLabelTop, groupAllOn && styles.groupRowLabelActive]}>{g.key}</Text>
                    </TouchableOpacity>
                    <View style={styles.groupRowChips}>
                      {g.items.map((r) => (
                        <Chip key={r.id} label={r.label} selected={regions.includes(r.id)} onPress={() => toggleRegion(r.id)} styles={styles} />
                      ))}
                    </View>
                  </View>
                </View>
              )
            })}
          </CollapsibleSection>

          {/* 가격 */}
          <CollapsibleSection title="가격" expanded={sectionExpanded['socfilter:price'] !== false} onToggle={() => toggleSection('socfilter:price')}>
            <View style={styles.chipGrid}>
              {PRICE_OPTIONS.map((p) => (
                <Chip key={String(p.value)} label={p.label} selected={maxPrice === p.value} onPress={() => setMaxPrice(p.value)} styles={styles} />
              ))}
            </View>
          </CollapsibleSection>

          {/* 요일 */}
          <CollapsibleSection title="요일" expanded={sectionExpanded['socfilter:day'] !== false} onToggle={() => toggleSection('socfilter:day')} last>
            <View style={styles.chipGrid}>
              {DAY_OPTIONS.map((d) => (
                <Chip key={d.id} label={d.label} selected={days.includes(d.id)} onPress={() => toggleDay(d.id)} styles={styles} />
              ))}
            </View>
          </CollapsibleSection>

          <View style={{ height: insets.bottom + 24 }} />
        </ScrollView>

        <View style={[styles.applyBar, { paddingBottom: insets.bottom + 10 }]}>
          <TouchableOpacity style={[styles.barBtn, styles.resetBtn]} onPress={handleReset} activeOpacity={0.85}>
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

function Chip({ label, selected, onPress, styles }: { label: string; selected: boolean; onPress: () => void; styles: any }) {
  return (
    <TouchableOpacity style={[styles.chip, selected && styles.chipSelected]} onPress={onPress}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  )
}

function makeStyles(colors: ReturnType<typeof useColors>, _bottom: number) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    headerTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
    chipGrid: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    groupTop: { fontSize: 14, fontWeight: '800', color: colors.textPrimary, marginTop: 12, marginBottom: 2 },
    groupRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 8, gap: 8 },
    groupRowLabel: { width: 60, paddingLeft: 10, paddingTop: 7, fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    groupRowLabelTop: { width: 60, paddingTop: 6, fontSize: 14, fontWeight: '800', color: colors.textPrimary },
    groupRowLabelActive: { color: colors.primary },
    groupRowChips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { backgroundColor: colors.surfaceHigh, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
    chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
    chipTextSelected: { color: '#fff', fontWeight: '700' },
    applyBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
    barBtn: { flex: 1, borderRadius: 14, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
    resetBtn: { backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.border },
    resetBtnText: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
    applyFab: { backgroundColor: colors.primary, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
    applyFabText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  })
}
