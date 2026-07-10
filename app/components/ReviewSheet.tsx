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
  ActivityIndicator,
  Keyboard,
  Platform,
  type KeyboardEvent,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import LoadingOverlay from '@/components/LoadingOverlay'
import { useColors } from '@/hooks/useColors'
import { submitReview, updateReview, type SubmittedReview } from '@/lib/reviews'
import { getLastNickname } from '@/lib/reviewIdentity'

const SCREEN_HEIGHT = Dimensions.get('window').height
const SHEET_MAX_HEIGHT = SCREEN_HEIGHT * 0.85
const DISMISS_THRESHOLD = 80

const NICK_MIN = 2
const NICK_MAX = 20
const CONTENT_MIN = 5
const CONTENT_MAX = 1000

export interface ReviewSheetInitial {
  id: string
  author_name: string | null
  rating: number | null
  content: string
}

interface Props {
  visible: boolean
  onClose: () => void
  companyId: string
  /** 편집 모드일 때 기존 후기를 넘기면 프리필 + 수정 동작 */
  initial?: ReviewSheetInitial | null
  /** 작성/수정 성공 시 호출(목록 새로고침용) */
  onDone?: (review: SubmittedReview) => void
}

export default function ReviewSheet({ visible, onClose, companyId, initial, onDone }: Props) {
  const insets = useSafeAreaInsets()
  const colors = useColors()
  const translateY = useRef(new Animated.Value(SHEET_MAX_HEIGHT)).current
  // 키보드 높이를 직접 추적해 시트를 밀어올림 → 닫힐 때 정확히 0으로 복귀(바닥에 딱 붙음)
  const kbHeight = useRef(new Animated.Value(0)).current

  const isEdit = !!initial

  useEffect(() => {
    if (!visible) return
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const onShow = (e: KeyboardEvent) => {
      Animated.timing(kbHeight, {
        toValue: e.endCoordinates.height,
        duration: e.duration || 250,
        useNativeDriver: false,
      }).start()
    }
    const onHide = (e: KeyboardEvent) => {
      Animated.timing(kbHeight, {
        toValue: 0,
        duration: e?.duration || 200,
        useNativeDriver: false,
      }).start()
    }
    const s = Keyboard.addListener(showEvt, onShow)
    const h = Keyboard.addListener(hideEvt, onHide)
    return () => {
      s.remove()
      h.remove()
    }
  }, [visible, kbHeight])

  const [nickname, setNickname] = useState('')
  const [rating, setRating] = useState(0)
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 열릴 때 프리필/초기화
  useEffect(() => {
    if (visible) {
      setNickname(initial?.author_name ?? '')
      setRating(initial?.rating ?? 0)
      setContent(initial?.content ?? '')
      setError(null)
      setSubmitting(false)
      // 신규 작성이면 마지막에 쓴 닉네임 자동 세팅(수정은 가능)
      if (!initial) {
        getLastNickname().then((last) => {
          if (last) setNickname((cur) => (cur ? cur : last))
        })
      }
    }
  }, [visible, initial])

  const openSheet = useCallback(() => {
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      damping: 20,
      stiffness: 200,
    }).start()
  }, [translateY])

  const closeSheet = useCallback(() => {
    Animated.timing(translateY, {
      toValue: SHEET_MAX_HEIGHT,
      duration: 220,
      useNativeDriver: true,
    }).start(() => onClose())
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
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) translateY.setValue(gs.dy)
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > DISMISS_THRESHOLD || gs.vy > 0.8) {
          closeSheet()
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 20,
            stiffness: 200,
          }).start()
        }
      },
    })
  ).current

  const nick = nickname.trim()
  const body = content.trim()
  const nickValid = nick.length >= NICK_MIN && nick.length <= NICK_MAX
  const ratingValid = rating >= 1 && rating <= 5
  const contentValid = body.length >= CONTENT_MIN && body.length <= CONTENT_MAX
  const canSubmit = nickValid && ratingValid && contentValid && !submitting

  const handleSubmit = async () => {
    if (submitting) return
    // 비활성 대신 무엇이 빠졌는지 안내
    if (!nickValid) { setError('닉네임을 2~20자로 입력해주세요.'); return }
    if (!ratingValid) { setError('별점을 선택해주세요.'); return }
    if (!contentValid) { setError('후기를 5자 이상 입력해주세요.'); return }
    setSubmitting(true)
    setError(null)
    const result = isEdit
      ? await updateReview({ reviewId: initial!.id, nickname: nick, rating, content: body })
      : await submitReview({ companyId, nickname: nick, rating, content: body })
    if ('error' in result) {
      setError(result.error)
      setSubmitting(false)
      return
    }
    setSubmitting(false)
    onDone?.(result.review)
    closeSheet()
  }

  const styles = useMemo(
    () =>
      StyleSheet.create({
        overlay: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.55)',
          justifyContent: 'flex-end',
        },
        sheet: {
          backgroundColor: colors.surface,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          maxHeight: SHEET_MAX_HEIGHT,
        },
        handleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
        handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border },
        headerRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.divider,
        },
        headerTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
        cancelText: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
        scrollContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12, gap: 18 },
        fieldLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
        input: {
          backgroundColor: colors.surfaceHigh,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 15,
          color: colors.textPrimary,
          borderWidth: 1,
          borderColor: colors.border,
        },
        textArea: { minHeight: 120, textAlignVertical: 'top' },
        starRow: { flexDirection: 'row', gap: 6 },
        counterRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 },
        counterText: { fontSize: 12, color: colors.textTertiary },
        errorBox: {
          backgroundColor: colors.error + '18',
          borderRadius: 10,
          paddingHorizontal: 14,
          paddingVertical: 10,
        },
        errorText: { fontSize: 13, color: colors.error, lineHeight: 19 },
        footer: {
          paddingHorizontal: 20,
          paddingTop: 12,
          borderTopWidth: 1,
          borderTopColor: colors.divider,
        },
        submitBtn: {
          backgroundColor: colors.primary,
          borderRadius: 14,
          paddingVertical: 15,
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 8,
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
        {/* 딤 배경 탭 → 닫기(시트 뒤 형제) */}
        <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
            {/* 드래그 핸들 + 헤더 (여기서만 스와이프 다운 닫기) */}
            <View {...panResponder.panHandlers}>
              <View style={styles.handleArea}>
                <View style={styles.handle} />
              </View>
              <View style={styles.headerRow}>
                <Text style={styles.headerTitle}>{isEdit ? '후기 수정' : '후기 작성'}</Text>
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
              {/* 닉네임 */}
              <View>
                <Text style={styles.fieldLabel}>닉네임</Text>
                <TextInput
                  style={styles.input}
                  placeholder="2~20자로 입력해주세요"
                  placeholderTextColor={colors.textTertiary}
                  value={nickname}
                  onChangeText={setNickname}
                  maxLength={NICK_MAX}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!submitting}
                />
              </View>

              {/* 별점 */}
              <View>
                <Text style={styles.fieldLabel}>별점</Text>
                <View style={styles.starRow}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <TouchableOpacity
                      key={n}
                      onPress={() => setRating(n)}
                      hitSlop={4}
                      disabled={submitting}
                      accessibilityLabel={`별점 ${n}점`}
                    >
                      <Ionicons
                        name={n <= rating ? 'star' : 'star-outline'}
                        size={34}
                        color={n <= rating ? '#FFB800' : colors.border}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* 후기 내용 */}
              <View>
                <Text style={styles.fieldLabel}>후기 내용</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="솔직한 후기를 남겨주세요 (5~1000자)"
                  placeholderTextColor={colors.textTertiary}
                  value={content}
                  onChangeText={setContent}
                  maxLength={CONTENT_MAX}
                  multiline
                  editable={!submitting}
                />
                <View style={styles.counterRow}>
                  <Text style={styles.counterText}>
                    {body.length} / {CONTENT_MAX}
                  </Text>
                </View>
              </View>

              {error && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}
            </ScrollView>

            {/* 제출 */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
              <TouchableOpacity
                style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={submitting}
                activeOpacity={0.85}
              >
                <Text style={[styles.submitBtnText, !canSubmit && styles.submitBtnTextDisabled]}>
                  {isEdit ? '수정 완료' : '후기 등록'}
                </Text>
              </TouchableOpacity>
            </View>
        </Animated.View>
      </Animated.View>
      <LoadingOverlay visible={submitting} />
    </Modal>
  )
}
