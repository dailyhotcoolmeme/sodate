import React, { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useColors } from '@/hooks/useColors'

interface Props {
  title: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
  /** 맨 아래 묶음이면 구분선을 그리지 않는다 */
  last?: boolean
}

/**
 * 필터/알림설정 화면 공용 접기·펼치기 섹션. 접힌 상태는 제목 한 줄만(화살표 포함),
 * 펼치면 내용 전체가 나온다(오너 지시 2026-08-12). 좌우 여백은 주지 않는다 —
 * 화면마다 바깥 컨테이너의 패딩이 달라(필터 20 / 알림설정 16) 여기서 또 주면 이중으로 밀린다.
 */
export default function CollapsibleSection({ title, expanded, onToggle, children, last = false }: Props) {
  const colors = useColors()
  const styles = useMemo(() => StyleSheet.create({
    wrap: {
      borderBottomWidth: last ? 0 : 1,
      borderBottomColor: colors.divider,
    },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
    title: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    body: { paddingBottom: 16 },
  }), [colors, last])

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.row} onPress={onToggle} activeOpacity={0.7}>
        <Text style={styles.title}>{title}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
      </TouchableOpacity>
      {expanded && <View style={styles.body}>{children}</View>}
    </View>
  )
}
