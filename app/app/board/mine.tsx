import React, { useMemo, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import AppSpinner from '@/components/AppSpinner'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { useMyPosts } from '@/hooks/useBoard'
import { wideContent } from '@/constants/layout'

/**
 * 내가 쓴 글 — 익명이라 목록에서 자기 글을 찾을 방법이 없어서 따로 둔다.
 * 기기에 저장한 id 로 찾으므로, 앱을 지우거나 기기를 바꾸면 목록이 비워진다.
 */
export default function MyPostsScreen() {
  const router = useRouter()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { posts, loading, refetch } = useMyPosts()

  useFocusEffect(useCallback(() => { refetch() }, [refetch]))

  return (
    <View style={styles.container}>
      <TopBar showBack onLogoPress={() => router.replace('/board')} />
      <Text style={styles.heading}>내가 쓴 글</Text>

      {loading && posts.length === 0 ? (
        <View style={styles.center}><AppSpinner /></View>
      ) : posts.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="create-outline" size={32} color={colors.textTertiary} />
          <Text style={styles.emptyText}>아직 쓴 글이 없어요</Text>
          <Text style={styles.emptySub}>게시판에 첫 글을 남겨보세요!</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[wideContent, { paddingBottom: insets.bottom + 20 }]}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={colors.primary} />}
        >
          {posts.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={styles.row}
              onPress={() => router.push(`/board/${p.id}`)}
              activeOpacity={0.7}
            >
              <View style={styles.titleLine}>
                <Text style={styles.title} numberOfLines={1}>{p.title}</Text>
                {p.comment_count > 0 && <Text style={styles.count}>[{p.comment_count}]</Text>}
                {/* 신고가 쌓여 숨겨진 글은 남에게 안 보인다. 작성자에게는 알려준다. */}
                {!p.is_active && <Text style={styles.hidden}>숨김</Text>}
              </View>
              <Text style={styles.meta}>
                {formatDate(p.created_at)} · 추천 {p.upvotes} · 비추 {p.downvotes}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    heading: {
      fontSize: 22, fontWeight: '800', color: colors.textPrimary,
      letterSpacing: -0.5, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 60 },
    emptyText: { fontSize: 15, color: colors.textSecondary, marginTop: 4 },
    emptySub: { fontSize: 13, color: colors.textTertiary },
    row: {
      paddingHorizontal: 16, paddingVertical: 11, gap: 3,
      borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    titleLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    title: { flexShrink: 1, fontSize: 14.5, color: colors.textPrimary },
    count: { flexShrink: 0, fontSize: 13, fontWeight: '700', color: colors.primary },
    hidden: {
      flexShrink: 0, fontSize: 10.5, fontWeight: '700', color: colors.error,
      borderWidth: 1, borderColor: colors.error, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1,
    },
    meta: { fontSize: 11.5, color: colors.textTertiary },
  })
}
