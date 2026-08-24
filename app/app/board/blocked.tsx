import React, { useMemo, useState, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import { useColors } from '@/hooks/useColors'
import { wideContent } from '@/constants/layout'
import { getBlockedAuthors, unblockAuthor, type BlockedAuthor } from '@/lib/boardIdentity'

/** 차단 목록 — 햄버거 → 커뮤니티 → 차단 목록. 여기서만 차단을 풀 수 있다. */
export default function BlockedAuthorsScreen() {
  const router = useRouter()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [list, setList] = useState<BlockedAuthor[]>([])

  const load = useCallback(() => { getBlockedAuthors().then(setList) }, [])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const handleUnblock = (b: BlockedAuthor) => {
    Alert.alert(`'${b.nickname}' 차단 해제`, '이 작성자의 글·댓글이 다시 보입니다.', [
      { text: '취소', style: 'cancel' },
      { text: '해제', onPress: async () => { await unblockAuthor(b.key); load() } },
    ])
  }

  return (
    <View style={styles.container}>
      <TopBar showBack onLogoPress={() => router.replace('/board')} />

      {list.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="eye-off-outline" size={32} color={colors.textTertiary} />
          <Text style={styles.emptyText}>차단한 작성자가 없어요</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[wideContent, { paddingBottom: insets.bottom + 20 }]}>
          {list.map((b) => (
            <View key={b.key} style={styles.row}>
              <Text style={styles.nickname}>{b.nickname}</Text>
              <TouchableOpacity onPress={() => handleUnblock(b)} hitSlop={8}>
                <Text style={styles.unblock}>차단 해제</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    heading: {
      fontSize: 22, fontWeight: '800', color: colors.textPrimary,
      letterSpacing: -0.5, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 60 },
    emptyText: { fontSize: 15, color: colors.textSecondary },
    row: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 13,
      borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    nickname: { fontSize: 14.5, color: colors.textPrimary, fontWeight: '600' },
    unblock: { fontSize: 13, color: colors.primary, fontWeight: '700' },
  })
}
