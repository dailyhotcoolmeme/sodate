import React, { useMemo, useCallback, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import AppSpinner from '@/components/AppSpinner'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { useMyPosts, useMyComments } from '@/hooks/useBoard'
import { wideContent } from '@/constants/layout'
import { useRefreshIndicator } from '@/hooks/useRefreshIndicator'

/**
 * 내가 쓴 글 — 익명이라 목록에서 자기 글을 찾을 방법이 없어서 따로 둔다.
 * 기기에 저장한 id 로 찾으므로, 앱을 지우거나 기기를 바꾸면 목록이 비워진다.
 *
 * 글/댓글은 탭으로 나눈다 — 디시인사이드·루리웹·클리앙·Reddit 전부 이 방식이고
 * 한 화면에 같이 보여주는 사례는 못 찾았다(2026-08-01 외부 조사, 오너 승인).
 */
export default function MyPostsScreen() {
  const router = useRouter()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const params = useLocalSearchParams<{ tab?: string }>()
  const [tab, setTab] = useState<'post' | 'comment'>(params.tab === 'comment' ? 'comment' : 'post')

  const { posts, loading: postsLoading, refetch: refetchPosts } = useMyPosts()
  const { comments, loading: commentsLoading, refetch: refetchComments } = useMyComments()
  const loading = tab === 'post' ? postsLoading : commentsLoading
  const { refreshing, onRefresh } = useRefreshIndicator(
    loading, tab === 'post' ? refetchPosts : refetchComments
  )

  useFocusEffect(useCallback(() => { refetchPosts(); refetchComments() }, [refetchPosts, refetchComments]))

  const isEmpty = tab === 'post' ? posts.length === 0 : comments.length === 0

  return (
    <View style={styles.container}>
      <TopBar showBack onLogoPress={() => router.replace('/board')} />
      <Text style={styles.heading}>내가 쓴 글</Text>

      <View style={styles.tabWrap}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'post' && styles.tabBtnOn]}
          onPress={() => setTab('post')}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'post' }}
        >
          <Text style={[styles.tabText, tab === 'post' && styles.tabTextOn]}>글({posts.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'comment' && styles.tabBtnOn]}
          onPress={() => setTab('comment')}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'comment' }}
        >
          <Text style={[styles.tabText, tab === 'comment' && styles.tabTextOn]}>댓글({comments.length})</Text>
        </TouchableOpacity>
      </View>

      {loading && isEmpty ? (
        <View style={styles.center}><AppSpinner /></View>
      ) : isEmpty ? (
        <View style={styles.center}>
          <Ionicons name="create-outline" size={32} color={colors.textTertiary} />
          <Text style={styles.emptyText}>
            {tab === 'post' ? '아직 쓴 글이 없어요' : '아직 쓴 댓글이 없어요'}
          </Text>
          {tab === 'post' && <Text style={styles.emptySub}>커뮤니티에 첫 글을 남겨보세요!</Text>}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[wideContent, { paddingBottom: insets.bottom + 20 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {tab === 'post' ? posts.map((p) => (
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
          )) : comments.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={styles.row}
              onPress={() => c.post_title && router.push(`/board/${c.post_id}`)}
              activeOpacity={c.post_title ? 0.7 : 1}
              disabled={!c.post_title}
            >
              {/* 원글 제목 — 무슨 글에 단 댓글인지 알아야 눌러서 찾아갈 수 있다 */}
              <Text style={styles.commentPostTitle} numberOfLines={1}>
                {c.post_title ?? '삭제된 글'}
              </Text>
              <View style={styles.titleLine}>
                <Text style={styles.commentBody} numberOfLines={2}>
                  {c.is_secret && '🔒 '}{c.content || '(비밀 댓글)'}
                </Text>
                {!c.is_active && <Text style={styles.hidden}>숨김</Text>}
              </View>
              <Text style={styles.meta}>{formatDate(c.created_at)}</Text>
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
    // 톱바 소개팅/커뮤니티 알약 탭은 톱바 전용 — 여기는 후기 섹션(ReviewSection)의
    // 밑줄 탭과 같은 방식을 쓴다(2026-08-01 오너 지적: 같은 표현을 두 군데 쓰지 않는다).
    tabWrap: {
      flexDirection: 'row', marginHorizontal: 16, marginBottom: 12,
      borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    tabBtn: {
      paddingHorizontal: 4, paddingVertical: 9, marginRight: 20,
      borderBottomWidth: 2, borderBottomColor: 'transparent',
    },
    tabBtnOn: { borderBottomColor: colors.primary },
    tabText: { fontSize: 14, fontWeight: '600', color: colors.textTertiary },
    tabTextOn: { color: colors.primary, fontWeight: '800' },
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
    // 댓글 탭: 원글 제목(작게) 위, 댓글 본문(크게) 아래 — 무엇에 단 댓글인지 먼저 보인다.
    commentPostTitle: { fontSize: 12, color: colors.textTertiary },
    commentBody: { flexShrink: 1, fontSize: 14.5, color: colors.textPrimary },
    hidden: {
      flexShrink: 0, fontSize: 10.5, fontWeight: '700', color: colors.error,
      borderWidth: 1, borderColor: colors.error, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1,
    },
    meta: { fontSize: 11.5, color: colors.textTertiary },
  })
}
