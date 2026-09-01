import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, RefreshControl, Animated, Alert,
  Modal, Pressable, ScrollView,
  type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import SwipeSegment from '@/components/SwipeSegment'
import BottomNav from '@/components/BottomNav'
import { NEW_TABS_ENABLED } from '@/constants/features'
import AppSpinner from '@/components/AppSpinner'
import LoadingOverlay from '@/components/LoadingOverlay'
import BoardBannerAd from '@/components/BoardBannerAd'
import BoardPromoBanner from '@/components/BoardPromoBanner'
import AuthorMenu, { AUTHOR_MENU_ENABLED, type AuthorMenuTarget } from '@/components/AuthorMenu'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import {
  useBoardList, useBoardSettings, useMyPostNewComments, PAGE_SIZE,
  type MyPostNewCommentGroup, type BoardPostWithTag,
} from '@/hooks/useBoard'
import { wideContent } from '@/constants/layout'
import { report } from '@/lib/board'
import {
  blockAuthor, markCommentsSeen, getReadPostIds, markBoardVisited,
  getToggleTip, setToggleTip,
} from '@/lib/boardIdentity'
import { consumeBoardEntry } from '@/lib/boardEntry'
import { getRecentSearches, addRecentSearch, removeRecentSearch, clearRecentSearches } from '@/lib/boardSearchHistory'
import { useRefreshIndicator } from '@/hooks/useRefreshIndicator'

/**
 * 게시판 목록 — 번호 페이지 방식(오너 확정). 무한 스크롤이 아니다.
 * 추천이 기준을 넘으면 제목이 굵어지고, 비추가 넘으면 흐려진다. 기준값은
 * board_settings 에서 읽어 코드 수정 없이 바꿀 수 있다.
 */

// ⚠️(2026-08-13) 글쓰기 FAB는 화면(screen) 기준 고정, 배너 광고는 스크롤 콘텐츠 기준이라
// 서로 다른 좌표계다 — 애드몹 정책상 광고 위에 다른 버튼을 겹치면 안 되므로(실수 클릭
// 유도 금지) 겹치지 않으면서도 스크롤을 끝까지 내렸을 때 광고 바로 밑에 자연스러운
// 간격(AD_FAB_GAP)만 남도록, 스크롤 콘텐츠의 paddingBottom을 FAB의 실제 크기 기준으로
// 역산해서 맞춘다. 숫자 하나를 감으로 늘렸다 줄였다 하면(90→120 등) 오히려 간격이
// 어긋난다 — 이 상수들만 바꾸면 항상 정확히 맞게 재계산된다.
const FAB_BOTTOM_OFFSET = 18   // writeBtnAbs의 bottom
const FAB_HEIGHT = 44          // writeBtn 실측 높이(paddingVertical 12*2 + 내용 약 20)
const AD_FAB_GAP = 16          // 광고 바로 밑~버튼 사이 원하는 간격
// 4탭 바텀 내비 높이(safe-area 제외한 바 자체). FAB(화면 기준 absolute)를 이만큼 더
// 올려야 안 가린다 — 안드로이드 3버튼 내비처럼 insets.bottom 이 작은 기기에서 글쓰기
// 버튼이 내비에 가려졌다(2026-08-24 오너 지적). BottomNav.tsx 의
// tab paddingTop9+paddingBottom8+아이콘22+라벨 기준.
//
// ⚠️ 스크롤 콘텐츠의 paddingBottom(위 KeyboardAwareScrollView)에는 이 값을 넣지 않는다 —
// BottomNav 는 FAB 와 달리 일반 flex 형제라 자기 높이만큼 스크롤뷰(flex:1)의 뷰포트를
// 이미 줄여놓는다. 거기에 또 더하면 스크롤 맨 밑에 내비 높이만큼의 빈 공간이 두 번
// 잡혀 하단이 휑해 보인다(2026-08-24 오너 지적: "하단 빈공간이 왜 갑자기 넓어졌지").
const BOTTOM_NAV_H = NEW_TABS_ENABLED ? 56 : 0
export default function BoardListScreen() {
  const router = useRouter()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  // 검색칸이 목록 맨 아래에 있던 걸 톱바 돋보기 아이콘 → 팝업 방식으로 옮겼다
  // (2026-08-13 오너 지시). 최근 검색어는 기기에 저장(lib/boardSearchHistory).
  const [searchModalVisible, setSearchModalVisible] = useState(false)

  // 커뮤니티에 한 번 들어왔다는 기록 — 모임 피드의 스와이프 힌트를 다시 안 보여주려는
  // 용도(2026-08-14, lib/boardIdentity.ts 참고).
  useEffect(() => { markBoardVisited() }, [])

  /**
   * "토글 버튼으로 바로 올 수 있어요" 말풍선(2026-08-20 오너 지시).
   *
   * 커뮤니티로 오는 길이 셋이라(토글·스와이프·햄버거 메뉴), 토글을 모르고 다른 길로만
   * 다니는 사람에게 한 번 알려준다. 첫 진입이 토글이었으면 이미 아는 사람이라 영영 안 띄운다.
   *
   * ⚠️ 진입 방식은 **마운트될 때 딱 한 번** 읽어야 한다(consume 이 값을 비운다).
   *    필터가 바뀌거나 리렌더될 때 다시 읽으면 그땐 이미 'unknown' 이라 판정이 틀어진다.
   * ⚠️ 'unknown'(앱 재시작 후 커뮤니티로 바로 복귀 등)은 "토글이 아님"이 아니라 "모름"이다.
   *    아무것도 저장하지 않고 판정을 미룬다 — 여기서 'pending' 을 넣으면 평소 토글만 쓰던
   *    사람에게도 말풍선이 뜬다.
   */
  const [showToggleTip, setShowToggleTip] = useState(false)
  useEffect(() => {
    const entry = consumeBoardEntry()
    let alive = true
    ;(async () => {
      const state = await getToggleTip()
      if (!alive) return
      if (state === 'done') return
      if (state === 'pending') { setShowToggleTip(true); return }
      // 여기부터는 첫 진입(state === null)
      if (entry === 'unknown') return          // 어떻게 왔는지 모른다 → 판정 보류
      if (entry === 'toggle') { setToggleTip('done'); return }
      setToggleTip('pending')
      setShowToggleTip(true)
    })()
    return () => { alive = false }
  }, [])

  const closeToggleTip = useCallback(() => {
    setShowToggleTip(false)
    setToggleTip('done')   // 닫으면 다시는 안 뜬다(오너 지시)
  }, [])

  const settings = useBoardSettings()
  const { posts, total, loading, error, pageCount, refetch } = useBoardList(page, search)
  // 읽은 글은 연하게(2026-08-13 오너 지시) — 기기에 저장된 목록, 상세 보고 돌아올
  // 때마다 최신화해야 하므로 아래 useFocusEffect에서 refetchAll과 같이 다시 불러온다.
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  // 내 글에 달린 새 댓글 — 목록 위 띠(2026-08-12 오너 지시). 푸시 없이 앱에서만 보인다.
  const { groups: newCommentGroups, refetch: refetchNewComments } = useMyPostNewComments()
  const [newCommentExpanded, setNewCommentExpanded] = useState(false)
  const newCommentTotal = newCommentGroups.reduce((sum, g) => sum + g.count, 0)
  const refetchAll = useCallback(() => { refetch(); refetchNewComments() }, [refetch, refetchNewComments])
  // 당김 표시는 다른 앱처럼 잠깐 붙잡아 둔다(거리는 iOS 기본값 그대로)
  const { refreshing, onRefresh } = useRefreshIndicator(loading, refetchAll)

  // 글을 쓰고 돌아오면 목록이 최신이어야 한다. 글 하나 보고 돌아왔을 때 그 글이 바로
  // 연하게 보이도록 읽은 글 목록도 같이 다시 불러온다.
  useFocusEffect(useCallback(() => {
    refetchAll()
    getReadPostIds().then((ids) => setReadIds(new Set(ids)))
  }, [refetchAll]))

  // 새 댓글 목록에서 글을 누르면: 읽음 처리하고 그 글의 댓글 위치로 이동한다.
  // 새 댓글이 딱 1개면 펼칠 필요 없이 눌렀을 때 바로 그 글로 간다(오너 지시).
  const openNewComment = (g: MyPostNewCommentGroup) => {
    markCommentsSeen(g.commentIds)
    setNewCommentExpanded(false)
    router.push(`/board/${g.postId}?commentId=${g.commentIds[0]}`)
    refetchNewComments()
  }

  const hot = settings?.hot_upvotes ?? 10
  const cold = settings?.cold_downvotes ?? 10

  // 글 목록에서 길게 눌러 작성자를 차단한다(애플 1.2 요건). 이 기기에서만 해당 작성자의
  // 글·댓글을 걸러 보이지 않게 하는 것과 별개로, 차단 자체가 운영자 신고로도 접수되어야
  // 한다 — 애플이 "blocking should also notify the developer"라고 명시(2026-08-04 반려
  // 재확인). 신고와 완전히 분리해뒀던 걸 여기서 합친다.
  // 등록·수정·삭제는 전부 화면 전체 중앙 스피너가 규칙인데 이 화면엔 로딩 표시
  // 자체가 없었다(2026-08-14 전수조사에서 발견).
  const [blocking, setBlocking] = useState(false)
  // 닉네임을 누르면 바로 이동하지 않고 그 자리에 작은 메뉴를 띄운다
  // (2026-08-19 오너 지적 — 스치기만 해도 화면이 통째로 바뀌면 안 된다).
  const [authorMenu, setAuthorMenu] = useState<AuthorMenuTarget | null>(null)
  const handleBlock = (post: BoardPostWithTag) => {
    Alert.alert(
      `'${post.nickname}' 차단`,
      '이 작성자의 글·댓글이 이 기기에서 더 이상 보이지 않습니다. 운영자에게도 신고로 접수됩니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '차단', style: 'destructive',
          onPress: async () => {
            setBlocking(true)
            await blockAuthor(post.owner_token, post.nickname)
            await report('post', post.id, '사용자 차단')
            setBlocking(false)
            refetch()
          },
        },
      ]
    )
  }

  // 글쓰기 FAB — 목록을 스크롤하면 아이콘만 남고 "글쓰기" 글자는 접힌다.
  // 맨 위로 돌아오면 다시 펼쳐진다(오너 지시, Material 확장 FAB의 표준 동작).
  const fabAnim = useRef(new Animated.Value(1)).current   // 1 = 글자 보임, 0 = 아이콘만
  const fabExpandedRef = useRef(true)
  const onListScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const expand = e.nativeEvent.contentOffset.y <= 8
    if (expand !== fabExpandedRef.current) {
      fabExpandedRef.current = expand
      Animated.timing(fabAnim, { toValue: expand ? 1 : 0, duration: 200, useNativeDriver: false }).start()
    }
  }

  // 검색 팝업에서 검색을 실행했을 때 — 최근 검색어에 남기고 실제 검색을 적용한다.
  const runSearch = (term: string) => {
    setPage(0)
    setSearch(term)
    addRecentSearch(term)
  }
  const clearSearch = () => { setSearch(''); setPage(0) }

  /**
   * 내 글에 달린 새 댓글 띠.
   *
   * 2026-08-12 에는 톱바 바로 밑(검색줄이 있던 자리)에 고정으로 뒀는데, 2026-08-19 에
   * 홍보 배너가 생기면서 이 띠가 배너보다 위에 뜨게 됐다. 오너 지시로 배너 아래로
   * 내린다(2026-08-20). 배너를 위로 고정하는 방법도 있었지만 이 앱은 sticky 를 쓰지
   * 않는 규칙이라, 띠를 목록과 같이 스크롤되는 자리로 옮겼다.
   *
   * 목록이 비었거나 조회에 실패한 화면에서도 이 띠는 살아 있어야 한다 — 내 글에 달린
   * 댓글은 게시판 상태와 무관하게 알려줘야 하므로 그 두 갈래에서도 같이 부른다.
   */
  const renderNewComments = () => {
    if (newCommentTotal === 0) return null
    return (
        newCommentTotal === 1 ? (
          <TouchableOpacity
            style={styles.newCommentRow}
            onPress={() => openNewComment(newCommentGroups[0])}
            activeOpacity={0.7}
          >
            <Ionicons name="chatbubble-ellipses" size={15} color={colors.primary} />
            <Text style={styles.newCommentText}>새로운 댓글 +1개</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.newCommentWrap}>
            <TouchableOpacity
              style={styles.newCommentHeader}
              onPress={() => setNewCommentExpanded((v) => !v)}
              activeOpacity={0.7}
            >
              <Ionicons name="chatbubble-ellipses" size={15} color={colors.primary} />
              <Text style={styles.newCommentText}>새로운 댓글 +{newCommentTotal}개</Text>
              <Ionicons name={newCommentExpanded ? 'chevron-up' : 'chevron-down'} size={15} color={colors.textTertiary} />
            </TouchableOpacity>
            {newCommentExpanded && (
              <View style={styles.newCommentList}>
                {newCommentGroups.map((g) => (
                  <TouchableOpacity
                    key={g.postId}
                    style={styles.newCommentItem}
                    onPress={() => openNewComment(g)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.newCommentItemTitle} numberOfLines={1}>{g.postTitle}</Text>
                    <Text style={styles.newCommentItemCount}>+{g.count}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )
    )
  }

  // 검색이 걸려 있을 때 목록 위에 보이는 슬림한 안내줄 — 검색칸 자체는 톱바 돋보기
  // → 팝업으로 옮겼지만(2026-08-13), 지금 검색 중이라는 사실과 지우기는 목록에서도
  // 바로 보여야 한다.
  const renderActiveSearchBar = () => (
    <View style={styles.searchInfoRow}>
      <Text style={styles.searchInfo} numberOfLines={1}>
        &lsquo;{search}&rsquo; 검색 결과 {total}건
      </Text>
      <TouchableOpacity onPress={clearSearch} hitSlop={8}>
        <Text style={styles.searchClear}>지우기</Text>
      </TouchableOpacity>
    </View>
  )

  return (
    <SwipeSegment current="board">
    <View style={styles.container}>
      <TopBar
        segment="board"
        onLogoPress={() => { setPage(0); refetchAll() }}
        onSearchPress={() => setSearchModalVisible(true)}
        showToggleTip={showToggleTip}
        onCloseToggleTip={closeToggleTip}
      />


      {loading && posts.length === 0 ? (
        <View style={styles.center}><AppSpinner /></View>
      ) : error ? (
        // ⚠️(2026-08-13) 조회가 실패해도 예전엔 posts=[] 그대로라 "아직 글이 없어요"로
        // 보였다 — 진짜 빈 상태와 구분이 안 돼 게시판이 통째로 고장나도 티가 안 났다
        // (같은 날 컬럼 rename 사고로 두 번 겪음). 실패는 실패라고 분명히 알려준다.
        <View style={{ flex: 1 }}>
          {renderNewComments()}
          <View style={styles.center}>
          <Ionicons name="construct-outline" size={32} color={colors.textTertiary} />
          <Text style={styles.emptyText}>일시적인 점검 중입니다</Text>
          <Text style={styles.emptySub}>잠시 후 다시 시도해주세요</Text>
          </View>
        </View>
      ) : posts.length === 0 ? (
        <View style={{ flex: 1 }}>
          {renderNewComments()}
          <View style={styles.center}>
          {search && <View style={styles.emptySearchRow}>{renderActiveSearchBar()}</View>}
          <Ionicons name="chatbubbles-outline" size={32} color={colors.textTertiary} />
          <Text style={styles.emptyText}>
            {search ? '검색 결과가 없어요' : '아직 글이 없어요'}
          </Text>
          {!search && <Text style={styles.emptySub}>첫 글을 남겨보세요!</Text>}
          </View>
        </View>
      ) : (
        <KeyboardAwareScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[wideContent, { flexGrow: 1, paddingBottom: (NEW_TABS_ENABLED ? 0 : insets.bottom) + FAB_BOTTOM_OFFSET + FAB_HEIGHT + AD_FAB_GAP }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          onScroll={onListScroll}
          scrollEventThrottle={16}
        >
          {search && renderActiveSearchBar()}

          {/* 맨 위 홍보 배너 — AdMob 아니라 우리가 만든 자체 배너다(2026-08-19 오너 지시).
              검색 중일 때는 검색 결과에 집중하도록 띄우지 않는다. */}
          {!search && <BoardPromoBanner />}

          {renderNewComments()}

          <View>
            {posts.map((p) => (
              <PostRow key={p.id} post={p} hot={hot} cold={cold} isRead={readIds.has(p.id)} styles={styles} colors={colors}
                onPress={() => router.push(`/board/${p.id}`)}
                onLongPress={() => handleBlock(p)}
                onAuthorPress={(x, y) => setAuthorMenu({ token: p.owner_token, nickname: p.nickname, x, y })} />
            ))}

            <Pager page={page} pageCount={pageCount} onChange={setPage} styles={styles} colors={colors} />

            {/* 페이지 번호 밑 배너 광고(2026-08-13 오너 지시) */}
            <BoardBannerAd />
          </View>
        </KeyboardAwareScrollView>
      )}

      <BoardSearchModal
        visible={searchModalVisible}
        onClose={() => setSearchModalVisible(false)}
        onSearch={runSearch}
        colors={colors}
      />

      {/* 글쓰기 — 목록 위에 떠 있다. 스크롤하면 아이콘만 남는다.
          ⚠️(2026-08-13 오너 지적) 안드로이드에서 배너 광고(네이티브 뷰)가 RN 뷰 쌓임 순서를
          무시하고 이 버튼 위에 그려져 버튼이 광고 밑에 깔려 보였다 — 바깥 View에
          renderToHardwareTextureAndroid를 줘서 별도 레이어로 띄우면 항상 위에 그려진다
          (iOS는 원래 문제없어 영향 없음, 이 prop이 TouchableOpacity 타입엔 없어 View로 감쌈). */}
      <View
        style={[styles.writeBtnAbs, { bottom: insets.bottom + BOTTOM_NAV_H + FAB_BOTTOM_OFFSET }]}
        renderToHardwareTextureAndroid
      >
        <TouchableOpacity
          style={styles.writeBtn}
          onPress={() => router.push('/board/write')}
          activeOpacity={0.85}
        >
          <Ionicons name="pencil" size={17} color="#fff" />
          <Animated.View
            style={{
              opacity: fabAnim,
              maxWidth: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 80] }),
              marginLeft: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 6] }),
              overflow: 'hidden',
            }}
          >
            <Text style={styles.writeBtnText} numberOfLines={1}>글쓰기</Text>
          </Animated.View>
        </TouchableOpacity>
      </View>

      <LoadingOverlay visible={blocking} />
      <AuthorMenu target={authorMenu} onClose={() => setAuthorMenu(null)} />
      {/* 4탭 바텀 내비 — NEW_TABS_ENABLED 꺼져 있으면 null(운영 무변화) */}
      <BottomNav current="board" />
    </View>
    </SwipeSegment>
  )
}

function PostRow({
  post, hot, cold, isRead, styles, colors, onPress, onLongPress, onAuthorPress,
}: {
  post: BoardPostWithTag
  hot: number
  cold: number
  isRead: boolean
  styles: ReturnType<typeof makeStyles>
  colors: AppColors
  onPress: () => void
  onLongPress: () => void
  onAuthorPress: (x: number, y: number) => void
}) {
  const isHot = post.upvotes >= hot
  const isCold = post.downvotes >= cold
  const hasImage = !!post.image_urls?.length
  const hasLink = !!post.link_urls?.length
  const tagLabel = post.board_tags?.label

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} onLongPress={onLongPress} activeOpacity={0.7}>
      <View style={styles.rowTitleLine}>
        <Text
          style={[styles.rowTitle, isHot && styles.rowTitleHot, isCold && styles.rowTitleCold, isRead && styles.rowTitleRead]}
          numberOfLines={1}
        >
          {/* 말머리 — admin(board_tags)에서 등록한 문자열을 그대로 붙인다(2026-08-12).
              읽은 글이면 말머리도 연한 핑크로 — 안 읽은 말머리들과 구분되게(2026-08-13 오너 지시). */}
          {!!tagLabel && <Text style={[styles.rowTag, isRead && styles.rowTagRead]}>{tagLabel} </Text>}
          {post.title}
        </Text>
        {/* 말머리·댓글수처럼 사진·링크 딱지도 읽은 글이면 연하게(2026-08-14 오너 지시 —
            "이미지 뿐만 아니라 다른 딱지들도 모두"). */}
        {hasImage && (
          <Ionicons name="image-outline" size={16} color={isRead ? colors.textTertiary : colors.textSecondary} style={styles.rowIcon} />
        )}
        {hasLink && (
          <Ionicons name="play-circle-outline" size={16} color={isRead ? colors.textTertiary : colors.textSecondary} style={styles.rowIcon} />
        )}
        {post.comment_count > 0 && (
          <Text style={[styles.rowCount, isRead && styles.rowTagRead]}>[{post.comment_count}]</Text>
        )}
      </View>
      <View style={styles.rowMetaRow}>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {/* 닉네임만 눌러서 그 작성자의 글·댓글로 갈 수 있다(2026-08-19 오너 지시).
              중첩 Text 의 onPress 는 글자 영역에서만 잡히므로, 나머지를 누르면
              평소처럼 글로 들어간다. */}
          {/* 기능을 숨긴 동안에는 onPress 를 아예 안 건다 — 눌러도 아무 일이 없으면
              고장 난 것처럼 보인다. AUTHOR_MENU_ENABLED 하나로 되살아난다. */}
          {AUTHOR_MENU_ENABLED
            ? <Text onPress={(e) => onAuthorPress(e.nativeEvent.pageX, e.nativeEvent.pageY)}>{post.nickname}</Text>
            : post.nickname}
          {' · '}{formatWhen(post.created_at)}
        </Text>
        <Text style={styles.rowMeta}>·</Text>
        <View style={styles.rowVoteItem}>
          <Ionicons name="thumbs-up-outline" size={11} color={colors.textTertiary} />
          <Text style={styles.rowMeta}>{post.upvotes}</Text>
        </View>
        <View style={styles.rowVoteItem}>
          <Ionicons name="thumbs-down-outline" size={11} color={colors.textTertiary} />
          <Text style={styles.rowMeta}>{post.downvotes}</Text>
        </View>
      </View>
    </TouchableOpacity>
  )
}

/**
 * 게시판 검색 팝업(2026-08-13, 톱바 돋보기 → 여기). 최근 검색어는 기기에 저장돼
 * 있다가 탭하면 바로 그 단어로 재검색, 개별/전체 삭제도 여기서 한다.
 */
function BoardSearchModal({
  visible, onClose, onSearch, colors,
}: {
  visible: boolean
  onClose: () => void
  onSearch: (term: string) => void
  colors: AppColors
}) {
  // ⚠️(2026-08-13 오너 지적) 팝업이 톱바에 너무 딱 붙어 보였다 — 고정값 80px로만
  // 띄웠더니 노치·다이나믹 아일랜드가 있는 기기(insets.top이 47~59px)에서는 톱바
  // 실제 높이(insets.top + 바 안쪽 높이 약 46px)보다 짧아 팝업이 톱바 밑단과 겹치거나
  // 거의 붙어 보였다. 안전영역을 반영해 톱바 바로 아래에 여백을 두고 뜨게 한다.
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeSearchModalStyles(colors, insets.top), [colors, insets.top])
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
              placeholder="제목·본문 검색"
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

function makeSearchModalStyles(colors: AppColors, topInset: number) {
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

/** 연도 2자리-월-일(요일) 시:분:초 — 오너 지시(2026-08-01). */
function formatWhen(iso: string): string {
  const d = new Date(iso)
  const days = ['일', '월', '화', '수', '목', '금', '토']
  const p = (n: number) => String(n).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${yy}-${p(d.getMonth() + 1)}-${p(d.getDate())}(${days[d.getDay()]}) ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
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
    emptySearchRow: { alignSelf: 'stretch', marginTop: 12 },

    // 검색 중 안내줄 — 톱바 돋보기(팝업)로 검색칸 자체는 옮겼지만(2026-08-13), 지금
    // 검색 중이라는 사실과 지우기는 목록 위에서도 바로 보여야 한다.
    searchInfoRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      marginHorizontal: 16, marginBottom: 8,
    },
    searchInfo: { flex: 1, fontSize: 12, color: colors.textSecondary },
    searchClear: { fontSize: 12, color: colors.textSecondary },

    // 새 댓글이 1개뿐이면 이 자체가 눌리는 배너(펼침 없음).
    newCommentRow: {
      flexDirection: 'row', alignItems: 'center', gap: 7,
      marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 9,
      backgroundColor: colors.primary + '14', borderRadius: 10,
    },
    // 2개 이상이면 펼침 목록을 담는 바깥 껍데기 — 마진·둥근 모서리는 여기서만 준다.
    newCommentWrap: { marginHorizontal: 16, marginBottom: 8, borderRadius: 10, overflow: 'hidden' },
    newCommentHeader: {
      flexDirection: 'row', alignItems: 'center', gap: 7,
      paddingHorizontal: 12, paddingVertical: 9,
      backgroundColor: colors.primary + '14',
    },
    newCommentText: { flex: 1, fontSize: 13.5, fontWeight: '700', color: colors.primary },
    newCommentList: { backgroundColor: colors.primary + '0a' },
    newCommentItem: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 14, paddingVertical: 9,
      borderTopWidth: 1, borderTopColor: colors.divider,
    },
    newCommentItemTitle: { flex: 1, fontSize: 13, color: colors.textPrimary },
    newCommentItemCount: { fontSize: 12, fontWeight: '700', color: colors.primary },

    row: {
      paddingHorizontal: 16, paddingVertical: 11,
      borderBottomWidth: 1, borderBottomColor: colors.divider, gap: 3,
    },
    rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    // lineHeight 명시 필수 — 없으면 이모지가 일반 글자보다 위아래로 커서 iOS에서 잘려 보인다
    // (안드로이드에서 넣은 이모지가 아이폰에서 잘리던 문제, 2026-08-08 오너 지적).
    rowTitle: { flexShrink: 1, fontSize: 14.5, lineHeight: 20, color: colors.textPrimary },
    rowTag: { color: colors.primary, fontWeight: '800' },
    // 읽은 글의 말머리 — primary 핑크에 알파를 줘서 연하게(테마 무관, primary가 라이트/다크 동일).
    rowTagRead: { color: `${colors.primary}80` },
    // 추천이 많으면 굵게, 비추가 많으면 흐리게(오너 확정). 흐려질 뿐 지워지지 않는다.
    rowTitleHot: { fontWeight: '800' },
    rowTitleCold: { color: colors.textTertiary },
    // 읽은 글은 연하게(2026-08-13 오너 지시) — hot/cold 색보다 우선 적용.
    rowTitleRead: { color: colors.textTertiary },
    rowIcon: { flexShrink: 0 },
    rowCount: { flexShrink: 0, fontSize: 13, fontWeight: '700', color: colors.primary },
    rowMeta: { fontSize: 11.5, color: colors.textTertiary },
    rowMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 },
    rowVoteItem: { flexDirection: 'row', alignItems: 'center', gap: 2 },

    pager: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, paddingVertical: 18 },
    pg: { minWidth: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
    pgOn: { backgroundColor: colors.primary },
    pgText: { fontSize: 13, color: colors.textSecondary },
    pgTextOn: { color: '#fff', fontWeight: '800' },
    pgTextOff: { color: colors.textTertiary, opacity: 0.4 },

    // 위치(absolute)는 renderToHardwareTextureAndroid를 받는 바깥 View가 담당.
    writeBtnAbs: { position: 'absolute', right: 18 },
    writeBtn: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999,
      backgroundColor: colors.primary,
      shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
      elevation: 5,
    },
    writeBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  })
}
