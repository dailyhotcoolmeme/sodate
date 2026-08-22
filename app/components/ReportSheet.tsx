import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  ScrollView,
  TextInput,
  Animated,
  PanResponder,
  Dimensions,
  Keyboard,
  Platform,
  type KeyboardEvent,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import LoadingOverlay from '@/components/LoadingOverlay'
import { useColors } from '@/hooks/useColors'
import { reportReview } from '@/lib/reviews'
import { reportPlaceReview } from '@/lib/placeReviews'
import { report as reportBoard } from '@/lib/board'

const SCREEN_HEIGHT = Dimensions.get('window').height
const SHEET_MAX_HEIGHT = SCREEN_HEIGHT * 0.85
const DISMISS_THRESHOLD = 80

// 시중 표준 신고 사유 + 기타(직접 입력)
const REASONS = ['스팸/광고', '욕설·비방', '허위 정보', '음란·부적절한 내용', '기타'] as const
const ETC = '기타'
const DETAIL_MAX = 200

interface Props {
  visible: boolean
  onClose: () => void
  reviewId: string | null
  /**
   * 게시판에서 쓸 때 지정한다. 주면 후기가 아니라 이쪽으로 신고가 간다.
   * 사유 목록·화면 구조는 후기와 똑같이 두고, 제목·안내문의 대상 이름만
   * 신고 대상에 맞게 바꾼다(2026-08-01 — "후기 신고"로 고정돼 있던 걸 지적받아 고침).
   */
  /** 'content' = 첨부(사진+유튜브 링크 등) 전체를 한꺼번에 신고 — 2026-08-13 일반화. */
  board?: { type: 'post' | 'comment' | 'content'; id: string } | null
  /** 혼술바(매장) 후기 신고면 true — reviews Edge Function 대신 place_reviews RPC로 보낸다. */
  placeReview?: boolean
  /** 신고 완료 시 호출 (already: 이미 신고한 대상 여부) */
  onReported?: (already: boolean) => void
}

export default function ReportSheet({ visible, onClose, reviewId, board, placeReview, onReported }: Props) {
  const insets = useSafeAreaInsets()
  const colors = useColors()
  const translateY = useRef(new Animated.Value(SHEET_MAX_HEIGHT)).current
  const kbHeight = useRef(new Animated.Value(0)).current

  const [selected, setSelected] = useState<number | null>(null)
  const [detail, setDetail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 열릴 때 초기화
  useEffect(() => {
    if (visible) {
      setSelected(null)
      setDetail('')
      setError(null)
      setSubmitting(false)
    }
  }, [visible])

  // 키보드 추적(기타 입력 시 시트 밀어올림)
  useEffect(() => {
    if (!visible) return
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const onShow = (e: KeyboardEvent) => {
      Animated.timing(kbHeight, { toValue: e.endCoordinates.height, duration: e.duration || 250, useNativeDriver: false }).start()
    }
    const onHide = (e: KeyboardEvent) => {
      Animated.timing(kbHeight, { toValue: 0, duration: e?.duration || 200, useNativeDriver: false }).start()
    }
    const s = Keyboard.addListener(showEvt, onShow)
    const h = Keyboard.addListener(hideEvt, onHide)
    return () => { s.remove(); h.remove() }
  }, [visible, kbHeight])

  const openSheet = useCallback(() => {
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 200 }).start()
  }, [translateY])

  const closeSheet = useCallback(() => {
    Keyboard.dismiss()
    Animated.timing(translateY, { toValue: SHEET_MAX_HEIGHT, duration: 220, useNativeDriver: true }).start(() => onClose())
  }, [translateY, onClose])

  useEffect(() => {
    if (visible) {
      translateY.setValue(SHEET_MAX_HEIGHT)
      openSheet()
    }
  }, [visible, openSheet, translateY])

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 5,
      onPanResponderMove: (_, gs) => { if (gs.dy > 0) translateY.setValue(gs.dy) },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > DISMISS_THRESHOLD || gs.vy > 0.8) {
          closeSheet()
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 200 }).start()
        }
      },
    })
  ).current

  const isEtc = selected !== null && REASONS[selected] === ETC
  const detailTrim = detail.trim()
  const canSubmit = selected !== null && (!isEtc || detailTrim.length >= 2) && !submitting
  // 화면 구조·사유 목록은 후기와 게시판이 똑같이 쓰지만, 제목·안내문에 들어가는
  // 대상 이름은 실제 신고 대상에 맞게 보여준다 — 게시글을 신고하는데 "후기"라고
  // 뜨면 헷갈린다(오너 지적, 2026-08-01: 제목만 고쳤다가 안내문에 "후기"가 남아있던
  // 걸 또 지적받아 여기서 같이 뺐다).
  const subject = !board ? '후기'
    : board.type === 'comment' ? '댓글'
    : board.type === 'content' ? '첨부'
    : '게시글'
  const sheetTitle = `${subject} 신고`

  const handleSubmit = async () => {
    if (submitting || (!reviewId && !board)) return
    if (selected === null) { setError('신고 사유를 선택해주세요.'); return }
    if (isEtc && detailTrim.length < 2) { setError('기타 사유를 2자 이상 입력해주세요.'); return }
    const reason = isEtc ? detailTrim : REASONS[selected]
    setSubmitting(true)
    setError(null)
    const result = board
      ? await reportBoard(board.type, board.id, reason)
      : placeReview
        ? await reportPlaceReview(reviewId!)
        : await reportReview(reviewId!, reason)
    if ('error' in result) {
      setError(result.error)
      setSubmitting(false)
      return
    }
    setSubmitting(false)
    onReported?.(('already' in result && result.already) === true)
    closeSheet()
  }

  const styles = useMemo(
    () =>
      StyleSheet.create({
        overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
        sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: SHEET_MAX_HEIGHT },
        handleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
        handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border },
        headerRow: {
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider,
        },
        headerTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
        cancelText: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
        scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, gap: 10 },
        guide: { fontSize: 13, color: colors.textSecondary, lineHeight: 19, marginBottom: 4 },
        // 사유 행 — 선택은 테두리·배경으로 표시(직선 체크 우측)
        reasonRow: {
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 16, paddingVertical: 15, borderRadius: 12,
          borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
        },
        reasonRowActive: { borderColor: colors.error, borderWidth: 2, backgroundColor: colors.error + '10' },
        reasonText: { fontSize: 15, color: colors.textPrimary, fontWeight: '500' },
        reasonTextActive: { color: colors.error, fontWeight: '700' },
        detailInput: {
          backgroundColor: colors.surfaceHigh, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
          fontSize: 15, color: colors.textPrimary, borderWidth: 1, borderColor: colors.border,
          minHeight: 80, textAlignVertical: 'top', marginTop: 2,
        },
        counterRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 },
        counterText: { fontSize: 12, color: colors.textTertiary },
        errorBox: { backgroundColor: colors.error + '18', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginTop: 4 },
        errorText: { fontSize: 13, color: colors.error, lineHeight: 19 },
        footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.divider },
        submitBtn: {
          backgroundColor: colors.error, borderRadius: 14, paddingVertical: 15,
          alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
        },
        submitBtnDisabled: { backgroundColor: colors.border },
        submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
        submitBtnTextDisabled: { color: colors.textTertiary },
      }),
    [colors]
  )

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={closeSheet} statusBarTranslucent>
      <Animated.View style={[styles.overlay, { paddingBottom: kbHeight }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          {/* 드래그 핸들 + 헤더 (여기서만 스와이프 다운 닫기) */}
          <View {...panResponder.panHandlers}>
            <View style={styles.handleArea}>
              <View style={styles.handle} />
            </View>
            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>{sheetTitle}</Text>
              <TouchableOpacity onPress={closeSheet} hitSlop={8} disabled={submitting}>
                <Text style={styles.cancelText}>취소</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            <Text style={styles.guide}>부적절한 {subject}를 신고해주세요. 신고 사유는 관리자 검토에 사용됩니다.</Text>

            {REASONS.map((r, i) => {
              const active = selected === i
              return (
                <TouchableOpacity
                  key={r}
                  style={[styles.reasonRow, active && styles.reasonRowActive]}
                  onPress={() => setSelected(i)}
                  activeOpacity={0.8}
                  disabled={submitting}
                >
                  <Text style={[styles.reasonText, active && styles.reasonTextActive]}>{r}</Text>
                  {active && <Ionicons name="checkmark-sharp" size={20} color={colors.error} />}
                </TouchableOpacity>
              )
            })}

            {isEtc && (
              <View>
                <TextInput
                  style={styles.detailInput}
                  placeholder="상세 사유를 입력해주세요 (2~200자)"
                  placeholderTextColor={colors.textTertiary}
                  value={detail}
                  onChangeText={setDetail}
                  maxLength={DETAIL_MAX}
                  multiline
                  editable={!submitting}
                  autoFocus
                />
                <View style={styles.counterRow}>
                  <Text style={styles.counterText}>{detailTrim.length} / {DETAIL_MAX}</Text>
                </View>
              </View>
            )}

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
            <TouchableOpacity
              style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.85}
            >
              <Text style={[styles.submitBtnText, !canSubmit && styles.submitBtnTextDisabled]}>
                신고하기
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Animated.View>
      <LoadingOverlay visible={submitting} />
    </Modal>
  )
}
