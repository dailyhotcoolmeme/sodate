import React, { useMemo, useCallback, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import AppSpinner from '@/components/AppSpinner'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { useAuthorActivity } from '@/hooks/useBoard'
import { wideContent } from '@/constants/layout'
import { useRefreshIndicator } from '@/hooks/useRefreshIndicator'
import { blockAuthor, unblockAuthor, isBlockedAuthor } from '@/lib/boardIdentity'

/**
 * 작성자 활동 — 커뮤니티에서 닉네임을 누르면 열린다(2026-08-19 오너 지시).
 *
 * 화면 구성은 '내가 쓴 글'(board/mine.tsx)과 똑같이 간다 — 오너가 이미 그 디자인을
 * 승인해서 쓰고 있고, 같은 성격의 목록을 두 가지 모양으로 두면 안 된다.
 *
 * 묶는 기준은 닉네임이 아니라 owner_token(기기)이다. 이유와 실측 근거는
 * hooks/useBoard.ts 의 useAuthorActivity 주석 참고 — 요약하면 'ㅇㅇ' 한 닉네임을
 * 서로 다른 5명이 쓰고 있어서 닉네임으로 묶으면 결과가 그냥 틀린다.
 *
 * 차단 버튼을 여기 둔다. 남의 활동을 훑어보다 "이 사람 그만 보고 싶다"가 되는 자리라
 * 글 상세까지 들어가지 않고 바로 끊을 수 있어야 한다.
 */
export default function AuthorScreen() {
  const router = useRouter()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { token, nickname, tab: tabParam } = useLocalSearchParams<{
    token: string; nickname?: string; tab?: 'post' | 'comment'
  }>()
  // 닉네임 메뉴에서 '게시글 보기'/'댓글 보기' 중 무엇을 골랐는지 그대로 열어준다
  // (2026-08-19 오너 지시). 직접 들어온 경우엔 글 탭.
  const [tab, setTab] = useState<'post' | 'comment'>(tabParam === 'comment' ? 'comment' : 'post')
  const [blocked, setBlocked] = useState(false)

  const { posts, comments, loading, refetch } = useAuthorActivity(token)
  const { refreshing, onRefresh } = useRefreshIndicator(loading, refetch)

  useFocusEffect(useCallback(() => {
    refetch()
    isBlockedAuthor(token).then(setBlocked)
  }, [refetch, token]))

  const displayName = nickname || posts[0]?.nickname || comments[0]?.nickname || '작성자'

  const toggleBlock = () => {
    if (blocked) {
      Alert.alert('차단 해제', `${displayName} 님의 글을 다시 볼까요?`, [
        { text: '취소', style: 'cancel' },
        { text: '해제', onPress: async () => { await unblockAuthor(token); setBlocked(false) } },
      ])
      return
    }
    Alert.alert(
      '이 작성자 차단',
      '차단하면 이 사람의 글과 댓글이 커뮤니티에서 보이지 않습니다. 언제든 해제할 수 있어요.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '차단',
          style: 'destructive',
          onPress: async () => { await blockAuthor(token, displayName); setBlocked(true) },
        },
      ]
    )
  }

  const isEmpty = tab === 'post' ? posts.length === 0 : comments.length === 0

  return (
    <View style={styles.container}>
      <TopBar showBack onLogoPress={() => router.replace('/board')} />

      <View style={styles.headRow}>
        <View style={styles.headLeft}>
          <Text style={styles.heading} numberOfLines={1}>{displayName}</Text>
          {/* 기기 기준으로 묶는다는 사실을 감추지 않는다 — 닉네임을 바꿔 쓴 글까지
              같이 나오는 이유를 모르면 사용자가 오작동으로 받아들인다. */}
          <Text style={styles.headSub}>같은 작성자가 남긴 글과 댓글이에요</Text>
        </View>
        <TouchableOpacity
          style={[styles.blockBtn, blocked && styles.blockBtnOn]}
          onPress={toggleBlock}
          activeOpacity={0.7}
        >
          <Text style={[styles.blockText, blocked && styles.blockTextOn]}>
            {blocked ? '차단 해제' : '차단'}
          </Text>
        </TouchableOpacity>
      </View>

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
          <Ionicons name="chatbubble-ellipses-outline" size={32} color={colors.textTertiary} />
          <Text style={styles.emptyText}>
            {tab === 'post' ? '작성한 글이 없어요' : '작성한 댓글이 없어요'}
          </Text>
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
              <Text style={styles.commentPostTitle} numberOfLines={1}>
                {c.post_title ?? '삭제된 글'}
              </Text>
              <Text style={styles.commentBody} numberOfLines={2}>{c.content}</Text>
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
    headRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    },
    headLeft: { flex: 1, minWidth: 0, gap: 3 },
    heading: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
    headSub: { fontSize: 12, color: colors.textTertiary },
    blockBtn: {
      flexShrink: 0, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
      borderWidth: 1, borderColor: colors.border,
    },
    blockBtnOn: { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
    blockText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    blockTextOn: { color: colors.primary },
    // 아래는 board/mine.tsx 와 같은 값 — 같은 성격의 목록이라 모양을 맞춘다.
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
    row: {
      paddingHorizontal: 16, paddingVertical: 11, gap: 3,
      borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    titleLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    title: { flexShrink: 1, fontSize: 14.5, color: colors.textPrimary },
    count: { flexShrink: 0, fontSize: 13, fontWeight: '700', color: colors.primary },
    commentPostTitle: { fontSize: 12, color: colors.textTertiary },
    commentBody: { fontSize: 14.5, color: colors.textPrimary },
    meta: { fontSize: 11.5, color: colors.textTertiary },
  })
}
