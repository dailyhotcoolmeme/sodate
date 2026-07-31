import React, { useMemo, useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, RefreshControl
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import AppSpinner from '@/components/AppSpinner'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { useBoardList, useBoardSettings, PAGE_SIZE } from '@/hooks/useBoard'
import { wideContent } from '@/constants/layout'
import type { BoardPost } from '@/lib/board'
import { useRefreshIndicator } from '@/hooks/useRefreshIndicator'

/**
 * 게시판 목록 — 번호 페이지 방식(오너 확정). 무한 스크롤이 아니다.
 * 추천이 기준을 넘으면 제목이 굵어지고, 비추가 넘으면 흐려진다. 기준값은
 * board_settings 에서 읽어 코드 수정 없이 바꿀 수 있다.
 */
export default function BoardListScreen() {
  const router = useRouter()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [draft, setDraft] = useState('')

  const settings = useBoardSettings()
  const { posts, total, loading, pageCount, refetch } = useBoardList(page, search)
  // 당김 표시는 다른 앱처럼 잠깐 붙잡아 둔다(거리는 iOS 기본값 그대로)
  const refreshing = useRefreshIndicator(loading)

  // 글을 쓰고 돌아오면 목록이 최신이어야 한다.
  useFocusEffect(useCallback(() => { refetch() }, [refetch]))

  const hot = settings?.hot_upvotes ?? 10
  const cold = settings?.cold_downvotes ?? 10

  return (
    <View style={styles.container}>
      <TopBar
        segment="board"
        onSearchPress={() => setSearchOpen((v) => !v)}
        onLogoPress={() => { setPage(0); refetch() }}
      />

      {searchOpen && (
        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={17} color={colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={draft}
            onChangeText={setDraft}
            placeholder="제목·본문 검색"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="search"
            autoFocus
            onSubmitEditing={() => { setPage(0); setSearch(draft) }}
          />
          {(draft.length > 0 || search.length > 0) && (
            <TouchableOpacity
              onPress={() => { setDraft(''); setSearch(''); setPage(0) }}
              hitSlop={8}
            >
              <Text style={styles.searchClear}>지우기</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {!!search && (
        <Text style={styles.searchInfo}>
          &lsquo;{search}&rsquo; 검색 결과 {total}건
        </Text>
      )}

      {loading && posts.length === 0 ? (
        <View style={styles.center}><AppSpinner /></View>
      ) : posts.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="chatbubbles-outline" size={32} color={colors.textTertiary} />
          <Text style={styles.emptyText}>
            {search ? '검색 결과가 없어요' : '아직 글이 없어요'}
          </Text>
          {!search && <Text style={styles.emptySub}>첫 글을 남겨보세요!</Text>}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[wideContent, { paddingBottom: insets.bottom + 90 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} tintColor={colors.primary} />}
        >
          {posts.map((p) => (
            <PostRow key={p.id} post={p} hot={hot} cold={cold} styles={styles} colors={colors}
              onPress={() => router.push(`/board/${p.id}`)} />
          ))}

          <Pager page={page} pageCount={pageCount} onChange={setPage} styles={styles} colors={colors} />
        </ScrollView>
      )}

      {/* 글쓰기 — 목록 위에 떠 있다 */}
      <TouchableOpacity
        style={[styles.writeBtn, { bottom: insets.bottom + 18 }]}
        onPress={() => router.push('/board/write')}
        activeOpacity={0.85}
      >
        <Ionicons name="pencil" size={17} color="#fff" />
        <Text style={styles.writeBtnText}>글쓰기</Text>
      </TouchableOpacity>
    </View>
  )
}

function PostRow({
  post, hot, cold, styles, colors, onPress,
}: {
  post: BoardPost
  hot: number
  cold: number
  styles: ReturnType<typeof makeStyles>
  colors: AppColors
  onPress: () => void
}) {
  const isHot = post.upvotes >= hot
  const isCold = post.downvotes >= cold
  const hasImage = !!post.image_urls?.length

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowTitleLine}>
        <Text
          style={[styles.rowTitle, isHot && styles.rowTitleHot, isCold && styles.rowTitleCold]}
          numberOfLines={1}
        >
          {post.title}
        </Text>
        {hasImage && (
          <Ionicons name="image-outline" size={13} color={colors.textTertiary} style={styles.rowIcon} />
        )}
        {post.comment_count > 0 && (
          <Text style={styles.rowCount}>[{post.comment_count}]</Text>
        )}
      </View>
      <Text style={styles.rowMeta}>
        {post.nickname} {formatWhen(post.created_at)} · 추천 {post.upvotes} · 비추 {post.downvotes}
      </Text>
    </TouchableOpacity>
  )
}

/** 오늘 글은 시각만, 지난 글은 날짜만 — 게시판에서 흔한 표기. */
function formatWhen(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  const p = (n: number) => String(n).padStart(2, '0')
  return sameDay ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${p(d.getMonth() + 1)}/${p(d.getDate())}`
}

/**
 * 번호 페이지. 현재 페이지를 가운데 두고 좌우로 다섯 개를 보여주고,
 * 양끝 « » 로 첫 페이지·마지막 페이지로 한 번에 간다(오너 확정 '나안').
 */
function Pager({
  page, pageCount, onChange, styles, colors,
}: {
  page: number
  pageCount: number
  onChange: (p: number) => void
  styles: ReturnType<typeof makeStyles>
  colors: AppColors
}) {
  if (pageCount <= 1) return null
  const WINDOW = 5
  let start = Math.max(0, page - Math.floor(WINDOW / 2))
  const end = Math.min(pageCount, start + WINDOW)
  start = Math.max(0, end - WINDOW)
  const nums = Array.from({ length: end - start }, (_, i) => start + i)

  const Arrow = ({ label, to, disabled }: { label: string; to: number; disabled: boolean }) => (
    <TouchableOpacity
      style={styles.pg}
      disabled={disabled}
      onPress={() => onChange(to)}
      hitSlop={4}
    >
      <Text style={[styles.pgText, disabled && styles.pgTextOff]}>{label}</Text>
    </TouchableOpacity>
  )

  return (
    <View style={styles.pager}>
      <Arrow label="«" to={0} disabled={page === 0} />
      <Arrow label="‹" to={Math.max(0, page - 1)} disabled={page === 0} />
      {nums.map((n) => (
        <TouchableOpacity
          key={n}
          style={[styles.pg, n === page && styles.pgOn]}
          onPress={() => onChange(n)}
        >
          <Text style={[styles.pgText, n === page && styles.pgTextOn]}>{n + 1}</Text>
        </TouchableOpacity>
      ))}
      <Arrow label="›" to={Math.min(pageCount - 1, page + 1)} disabled={page >= pageCount - 1} />
      <Arrow label="»" to={pageCount - 1} disabled={page >= pageCount - 1} />
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 60 },
    emptyText: { fontSize: 15, color: colors.textSecondary, marginTop: 4 },
    emptySub: { fontSize: 13, color: colors.textTertiary },

    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 9,
      backgroundColor: colors.surfaceHigh, borderRadius: 10,
    },
    searchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, padding: 0 },
    searchClear: { fontSize: 12, color: colors.textSecondary },
    searchInfo: { fontSize: 12, color: colors.textSecondary, paddingHorizontal: 16, paddingBottom: 6 },

    row: {
      paddingHorizontal: 16, paddingVertical: 11,
      borderBottomWidth: 1, borderBottomColor: colors.divider, gap: 3,
    },
    rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    rowTitle: { flexShrink: 1, fontSize: 14.5, color: colors.textPrimary },
    // 추천이 많으면 굵게, 비추가 많으면 흐리게(오너 확정). 흐려질 뿐 지워지지 않는다.
    rowTitleHot: { fontWeight: '800' },
    rowTitleCold: { color: colors.textTertiary },
    rowIcon: { flexShrink: 0 },
    rowCount: { flexShrink: 0, fontSize: 13, fontWeight: '700', color: colors.primary },
    rowMeta: { fontSize: 11.5, color: colors.textTertiary },

    pager: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, paddingVertical: 18 },
    pg: { minWidth: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
    pgOn: { backgroundColor: colors.primary },
    pgText: { fontSize: 13, color: colors.textSecondary },
    pgTextOn: { color: '#fff', fontWeight: '800' },
    pgTextOff: { color: colors.textTertiary, opacity: 0.4 },

    writeBtn: {
      position: 'absolute', right: 18, flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999,
      backgroundColor: colors.primary,
      shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
      elevation: 5,
    },
    writeBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  })
}
