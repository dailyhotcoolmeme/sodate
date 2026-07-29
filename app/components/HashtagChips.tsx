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
  // 리스트에서 줄간격 균일하게: 자체 상하 마진 제거
  tight?: boolean
}

// 소개팅 제목 바로 아래에 표시하는 해시태그 배지.
// 누르면 해당 태그로 필터를 적용하고 목록(홈)으로 이동한다.
export default function HashtagChips({ hashtags, size = 'sm', tight = false }: Props) {
  const colors = useColors()
  const router = useRouter()

  const tags = useMemo(
    () => (hashtags ?? []).filter((t) => !!t && t.trim().length > 0),
    [hashtags]
  )

  const styles = useMemo(
    () =>
      StyleSheet.create({
        // tight(리스트/카드): 가로 ScrollView가 세로 flex 안에서 높이가 애매하게 커져
        //   제목-해시태그 간격이 슬롯마다 달라지는 문제 → 명시적 높이로 고정.
        scroll: tight
          ? { marginTop: 0, marginBottom: 0, height: size === 'md' ? 20 : 17, flexGrow: 0, flexShrink: 0 }
          : { marginTop: 1, marginBottom: 2 },
        row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
        chip: {
          paddingVertical: tight ? 0 : 2,
        },
        chipText: {
          color: colors.primary,
          fontSize: size === 'md' ? 12.5 : 11,
          fontWeight: '700',
          lineHeight: tight ? (size === 'md' ? 18 : 15) : undefined,
        },
      }),
    [colors, size, tight]
  )

  if (tags.length === 0) return null

  // ⚠️ 개수 제한 없이 전부 담는다(오너 확정 2026-07-29). 예전엔 피드 3개·상세 4개로
  //    잘라서 뒤쪽 태그(#30대 등)가 아예 안 보였다. 폭은 부모(모임명 컬럼)에 맞고,
  //    넘치면 가로 스크롤(스크롤바 미노출)로 밀어 본다. 높이는 한 줄 고정 그대로.
  const shown = tags

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
