import React, { useMemo, useCallback, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import AppSpinner from '@/components/AppSpinner'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { fetchMyScraps, toggleScrap, type BoardPost } from '@/lib/board'
import { wideContent } from '@/constants/layout'

/**
 * 스크랩한 글 — MY 탭 진입. 글 상세의 스크랩 버튼으로 담아둔 글을 최신순으로 본다.
 * 소유권은 기기(owner_token) 기준이라 앱을 지우거나 기기를 바꾸면 비워진다(내 글 목록과 같음).
 * 목록은 서버(board_scraps)가 정본 — 진입할 때마다 다시 받아 그린다.
 */
export default function ScrapsScreen() {
  const router = useRouter()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [posts, setPosts] = useState<BoardPost[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    const r = await fetchMyScraps()
    if (!('error' in r)) setPosts(r.posts)
    setLoading(false)
    setRefreshing(false)
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  // 스크랩 해제 — 목록에서 바로(2026-08-24 오너 지시: 글 상세까지 안 들어가고 여기서 뺄 수 있어야 함).
  const handleUnscrap = async (postId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId)) // 낙관적 반영
    const r = await toggleScrap(postId)
    if ('error' in r || r.scrapped) load() // 실패했거나(원래 스크랩 안 된 상태였다면) 서버 상태로 다시 맞춘다
  }

  const isEmpty = posts.length === 0

  return (
    <View style={styles.container}>
      <TopBar showBack title="스크랩한 글" onLogoPress={() => router.replace('/board')} />

      {loading && isEmpty ? (
        <View style={styles.center}><AppSpinner /></View>
      ) : isEmpty ? (
        <View style={styles.center}>
          <Ionicons name="bookmarks-outline" size={32} color={colors.textTertiary} />
          <Text style={styles.emptyText}>아직 스크랩한 글이 없어요</Text>
          <Text style={styles.emptySub}>글 상세에서 북마크를 눌러 담아두세요!</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[wideContent, { paddingTop: 8, paddingBottom: insets.bottom + 20 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
        >
          {posts.map((p) => (
            <TouchableOpacity
              key={p.id} style={styles.row}
              onPress={() => router.push(`/board/${p.id}`)} activeOpacity={0.7}
            >
              <View style={styles.rowText}>
                <View style={styles.titleLine}>
                  <Text style={styles.title} numberOfLines={1}>{p.title}</Text>
                  {p.comment_count > 0 && <Text style={styles.count}>[{p.comment_count}]</Text>}
                </View>
                <Text style={styles.meta}>
                  {formatDate(p.created_at)} · 추천 {p.upvotes} · 비추 {p.downvotes}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.unscrapBtn}
                onPress={(e) => { e.stopPropagation?.(); handleUnscrap(p.id) }}
                activeOpacity={0.7}
                hitSlop={8}
              >
                <Ionicons name="bookmark" size={20} color="#FF6B9D" />
              </TouchableOpacity>
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
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 16, paddingVertical: 11,
      borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    rowText: { flex: 1, gap: 3 },
    unscrapBtn: { padding: 2 },
    titleLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    title: { flexShrink: 1, fontSize: 14.5, color: colors.textPrimary },
    count: { flexShrink: 0, fontSize: 13, fontWeight: '700', color: colors.primary },
    meta: { fontSize: 11.5, color: colors.textTertiary },
  })
}
