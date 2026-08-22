import React, { useMemo, useState, useEffect } from 'react'
import { Modal, View, Pressable, TextInput, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { AppColors } from '@/constants/colors'
import { getRecentSearches, removeRecentSearch, clearRecentSearches } from '@/lib/eventSearchHistory'

/**
 * 모임 검색 팝업(소개팅·소셜링 공용) — 톱바 돋보기로 연다. 톱바 아래 카드에 입력창 + 최근 검색어.
 * 원래 app/index.tsx 안에 있던 EventSearchModal 을 소셜링과 공유하려고 공용 컴포넌트로 승격
 * (2026-08-21). 최근 검색어 저장소(eventSearchHistory)는 소개팅·소셜링이 함께 쓴다 — 둘 다
 * 같은 events 테이블(모임)을 검색하므로 검색어를 나눌 이유가 없다.
 */
export default function EventSearchModal({
  visible, onClose, onSearch, colors, placeholder = '모임명·해시태그 검색',
}: {
  visible: boolean
  onClose: () => void
  onSearch: (term: string) => void
  colors: AppColors
  placeholder?: string
}) {
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors, insets.top), [colors, insets.top])
  const [draft, setDraft] = useState('')
  const [recent, setRecent] = useState<string[]>([])

  useEffect(() => {
    if (!visible) return
    setDraft('')
    getRecentSearches().then(setRecent)
  }, [visible])

  const submit = (term: string) => {
    const t = term.trim()
    if (!t) return
    onSearch(t)
    onClose()
  }

  const removeOne = async (term: string) => {
    await removeRecentSearch(term)
    setRecent((prev) => prev.filter((v) => v !== term))
  }

  const clearAll = async () => {
    await clearRecentSearches()
    setRecent([])
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.card}>
          <View style={styles.inputRow}>
            <Ionicons name="search-outline" size={18} color={colors.textTertiary} />
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={placeholder}
              placeholderTextColor={colors.textTertiary}
              returnKeyType="search"
              autoFocus
              onSubmitEditing={() => submit(draft)}
            />
            {draft.length > 0 && (
              <TouchableOpacity onPress={() => setDraft('')} hitSlop={8}>
                <Ionicons name="close-circle" size={17} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>

          {recent.length > 0 && (
            <>
              <View style={styles.recentHeader}>
                <Text style={styles.recentTitle}>최근 검색어</Text>
                <TouchableOpacity onPress={clearAll} hitSlop={6}>
                  <Text style={styles.clearAll}>전체 삭제</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.recentList} keyboardShouldPersistTaps="handled" bounces={false}>
                {recent.map((term) => (
                  <View key={term} style={styles.recentRow}>
                    <TouchableOpacity style={styles.recentTermBtn} onPress={() => submit(term)} activeOpacity={0.7}>
                      <Ionicons name="time-outline" size={14} color={colors.textTertiary} />
                      <Text style={styles.recentTerm} numberOfLines={1}>{term}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => removeOne(term)} hitSlop={8}>
                      <Ionicons name="close" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  )
}

function makeStyles(colors: AppColors, topInset: number) {
  // 톱바 실제 높이 = insets.top(안전영역) + 바 안쪽 높이(위아래 패딩 10+10 + 가장 큰
  // 아이콘 26 ≈ 46). 그 아래 시각적 여백(14px)까지 더해 톱바에 안 붙게 띄운다.
  const topOffset = topInset + 46 + 14
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'flex-start', padding: 16, paddingTop: topOffset },
    card: {
      width: '100%', maxWidth: 420, maxHeight: '70%', borderRadius: 16, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10,
      shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16,
      elevation: 12,
    },
    inputRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.surfaceHigh, borderRadius: 12,
      paddingHorizontal: 12, paddingVertical: 10,
      borderWidth: 1, borderColor: colors.border,
    },
    input: { flex: 1, fontSize: 15, color: colors.textPrimary, padding: 0 },
    recentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2 },
    recentTitle: { fontSize: 12.5, fontWeight: '700', color: colors.textSecondary },
    clearAll: { fontSize: 12, color: colors.textTertiary },
    recentList: { flexGrow: 0 },
    recentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
    recentTermBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
    recentTerm: { flex: 1, fontSize: 14, color: colors.textPrimary },
  })
}
