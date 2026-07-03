import React, { useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  GestureResponderEvent,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useColors } from '@/hooks/useColors'
import { useFilterStore } from '@/stores/filterStore'

interface Props {
  hashtags?: string[] | null
  // 카드/리스트=작게, 상세=조금 크게
  size?: 'sm' | 'md'
  // 한 줄에 노출할 최대 개수 (넘치면 가로 스크롤)
  max?: number
}

// 소개팅 제목 바로 아래에 표시하는 해시태그 배지.
// 누르면 해당 태그로 필터를 적용하고 목록(홈)으로 이동한다.
export default function HashtagChips({ hashtags, size = 'sm', max = 3 }: Props) {
  const colors = useColors()
  const router = useRouter()

  const tags = useMemo(
    () => (hashtags ?? []).filter((t) => !!t && t.trim().length > 0),
    [hashtags]
  )

  const styles = useMemo(
    () =>
      StyleSheet.create({
        scroll: { marginTop: 6, marginBottom: 2 },
        row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
        chip: {
          backgroundColor: colors.tagBackground,
          borderRadius: 8,
          paddingHorizontal: size === 'md' ? 10 : 8,
          paddingVertical: size === 'md' ? 5 : 3,
        },
        chipText: {
          color: colors.primary,
          fontSize: size === 'md' ? 12.5 : 11,
          fontWeight: '700',
        },
      }),
    [colors, size]
  )

  if (tags.length === 0) return null

  const shown = tags.slice(0, max)

  const handlePress = (e: GestureResponderEvent, tag: string) => {
    e.stopPropagation?.()
    useFilterStore.getState().setHashtags([tag])
    // 카드/상세 어디서 눌러도 목록으로 이동 (필터는 전역 상태라 즉시 반영)
    router.navigate('/')
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      {shown.map((tag) => (
        <TouchableOpacity
          key={tag}
          style={styles.chip}
          activeOpacity={0.7}
          onPress={(e) => handlePress(e, tag)}
        >
          <Text style={styles.chipText} numberOfLines={1}>
            {tag}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  )
}
