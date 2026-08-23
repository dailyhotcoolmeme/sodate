import React, { useMemo } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'

/** 글쓰기 투표 초안 — write.tsx state 로 관리, 글 등록 후 createPoll 로 저장. */
export interface PollDraft {
  question: string
  options: string[]         // 2~5개
  allowMulti: boolean
  durationDays: number | null   // null=무기한, 1/3/7
}

export const emptyPollDraft = (): PollDraft => ({ question: '', options: ['', ''], allowMulti: false, durationDays: 3 })
export const MAX_POLL_OPTIONS = 5

const DURATIONS: { label: string; days: number | null }[] = [
  { label: '1일', days: 1 }, { label: '3일', days: 3 }, { label: '7일', days: 7 }, { label: '무기한', days: null },
]

export default function PollEditor({ draft, onChange, onRemove }: {
  draft: PollDraft
  onChange: (d: PollDraft) => void
  onRemove: () => void
}) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const set = (patch: Partial<PollDraft>) => onChange({ ...draft, ...patch })

  const setOption = (i: number, v: string) => {
    const next = draft.options.slice(); next[i] = v; set({ options: next })
  }
  const addOption = () => { if (draft.options.length < MAX_POLL_OPTIONS) set({ options: [...draft.options, ''] }) }
  const removeOption = (i: number) => { if (draft.options.length > 2) set({ options: draft.options.filter((_, k) => k !== i) }) }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headL}><Ionicons name="bar-chart-outline" size={16} color={colors.primary} /><Text style={styles.headText}>투표</Text></View>
        <TouchableOpacity onPress={onRemove} hitSlop={8}><Ionicons name="close" size={20} color={colors.textTertiary} /></TouchableOpacity>
      </View>

      <TextInput
        style={styles.qInput}
        value={draft.question}
        onChangeText={(t) => set({ question: t })}
        placeholder="투표 질문 (선택)"
        placeholderTextColor={colors.textTertiary}
        maxLength={200}
      />

      {draft.options.map((o, i) => (
        <View key={i} style={styles.optRow}>
          <Text style={styles.optNum}>{i + 1}</Text>
          <TextInput
            style={styles.optInput}
            value={o}
            onChangeText={(t) => setOption(i, t)}
            placeholder={`항목 ${i + 1}`}
            placeholderTextColor={colors.textTertiary}
            maxLength={60}
          />
          {draft.options.length > 2 && (
            <TouchableOpacity onPress={() => removeOption(i)} hitSlop={8}><Ionicons name="remove-circle-outline" size={20} color={colors.textTertiary} /></TouchableOpacity>
          )}
        </View>
      ))}

      {draft.options.length < MAX_POLL_OPTIONS && (
        <TouchableOpacity style={styles.addOpt} onPress={addOption} hitSlop={6}>
          <Ionicons name="add" size={18} color={colors.primary} />
          <Text style={styles.addOptText}>항목 추가 (최대 {MAX_POLL_OPTIONS}개)</Text>
        </TouchableOpacity>
      )}

      <View style={styles.settings}>
        <TouchableOpacity style={styles.multiRow} onPress={() => set({ allowMulti: !draft.allowMulti })} hitSlop={6}>
          <Ionicons name={draft.allowMulti ? 'checkbox' : 'square-outline'} size={20} color={draft.allowMulti ? colors.primary : colors.textTertiary} />
          <Text style={styles.multiText}>복수 선택</Text>
        </TouchableOpacity>
        <View style={styles.durWrap}>
          <Text style={styles.durLabel}>마감</Text>
          <View style={styles.durChips}>
            {DURATIONS.map((d) => {
              const on = draft.durationDays === d.days
              return (
                <TouchableOpacity key={d.label} style={[styles.durChip, on && styles.durChipOn]} onPress={() => set({ durationDays: d.days })}>
                  <Text style={[styles.durChipText, on && styles.durChipTextOn]}>{d.label}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>
      </View>
    </View>
  )
}

/** durationDays → ISO ends_at(null 이면 무기한). */
export function durationToEndsAt(days: number | null): string | null {
  if (days == null) return null
  return new Date(Date.now() + days * 86400000).toISOString()
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    card: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, backgroundColor: colors.surface, gap: 8, marginTop: 12 },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headL: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    headText: { fontSize: 14, fontWeight: '800', color: colors.primary },
    qInput: { backgroundColor: colors.surfaceHigh, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14.5, color: colors.textPrimary, borderWidth: 1, borderColor: colors.border },
    optRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    optNum: { width: 16, textAlign: 'center', fontSize: 13, fontWeight: '700', color: colors.textTertiary },
    optInput: { flex: 1, backgroundColor: colors.surfaceHigh, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14.5, color: colors.textPrimary, borderWidth: 1, borderColor: colors.border },
    addOpt: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingLeft: 24 },
    addOptText: { fontSize: 13.5, color: colors.primary, fontWeight: '600' },
    settings: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 10, gap: 10 },
    multiRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    multiText: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
    durWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    durLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
    durChips: { flexDirection: 'row', gap: 6, flex: 1 },
    durChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
    durChipOn: { borderColor: colors.primary, backgroundColor: colors.primary + '14' },
    durChipText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
    durChipTextOn: { color: colors.primary, fontWeight: '800' },
  })
}
