import React, { useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useColors } from '@/hooks/useColors'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const BADGE_SIZE = 32

function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayKey(): string {
  return toDateKey(new Date())
}

interface Props {
  startDate: string | null
  endDate: string | null
  onChange: (start: string | null, end: string | null) => void
}

/**
 * 시작~종료 날짜를 달력 하나에서 탭 두 번으로 고른다(시작 탭 → 종료 탭).
 * 시스템 달력 대신 앱 디자인 톤(핑크 primary, 둥근 칩)에 맞춘 자체 구현(오너 지시 2026-08-11).
 */
export default function DateRangeCalendar({ startDate, endDate, onChange }: Props) {
  const colors = useColors()
  const [viewDate, setViewDate] = useState(() => {
    const base = startDate ? new Date(startDate + 'T00:00:00') : new Date()
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })
  const today = todayKey()

  const styles = useMemo(() => StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    navBtn: { padding: 4 },
    monthLabel: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    weekRow: { flexDirection: 'row' },
    weekCell: { flex: 1, alignItems: 'center', paddingBottom: 6 },
    weekText: { fontSize: 12, color: colors.textTertiary, fontWeight: '600' },
    dayRow: { flexDirection: 'row' },
    // 셀 자체가 정사각(aspectRatio:1)이라 안의 배지 크기를 %로 잡으면(78% 등) Yoga가
    // 부모 높이를 aspectRatio로 늦게 확정하는 타이밍과 꼬여 원이 아니라 셀에 가까운 큰
    // 사각형으로 렌더링되는 문제가 있었다(2026-08-12 스크린샷으로 확인). 배지를 고정
    // px(SIZE)로, 퍼센트 사이즈 없이 셀의 alignItems/justifyContent 중앙정렬만으로 배치.
    dayCell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
    // 범위 사이(시작·종료 제외) 날짜만 셀 전체를 사각 틴트로 채워 이어준다.
    dayFillInRange: {
      position: 'absolute', left: 0, right: 0, top: '11%', bottom: '11%',
      backgroundColor: colors.primary + '20',
    },
    dayCircle: {
      width: BADGE_SIZE, height: BADGE_SIZE,
      minWidth: BADGE_SIZE, minHeight: BADGE_SIZE, maxWidth: BADGE_SIZE, maxHeight: BADGE_SIZE,
      borderRadius: 999, overflow: 'hidden', flexGrow: 0, flexShrink: 0, alignSelf: 'center',
      alignItems: 'center', justifyContent: 'center',
    },
    dayCircleSelected: { backgroundColor: colors.primary },
    dayCircleToday: { borderWidth: 1.5, borderColor: colors.primary },
    dayText: { fontSize: 14, color: colors.textPrimary },
    dayTextSelected: { color: '#fff', fontWeight: '700' },
    dayTextDisabled: { color: colors.textTertiary, opacity: 0.4 },
    footer: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.divider,
    },
    footerText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
    clearText: { fontSize: 13, color: colors.textTertiary, fontWeight: '600' },
  }), [colors])

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const monthLabel = `${year}년 ${month + 1}월`

  const cells = useMemo(() => {
    const firstDay = new Date(year, month, 1)
    const startOffset = firstDay.getDay() // 0=일
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const out: (string | null)[] = []
    for (let i = 0; i < startOffset; i++) out.push(null)
    for (let d = 1; d <= daysInMonth; d++) out.push(toDateKey(new Date(year, month, d)))
    while (out.length % 7 !== 0) out.push(null)
    return out
  }, [year, month])

  const handlePress = (key: string) => {
    if (key < today) return // 지난 날짜는 선택 불가
    if (!startDate || (startDate && endDate)) {
      // 새로 시작
      onChange(key, null)
    } else if (key < startDate) {
      onChange(key, null)
    } else if (key === startDate) {
      onChange(startDate, key) // 하루만 선택
    } else {
      onChange(startDate, key)
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.navBtn}
          hitSlop={8}
          onPress={() => setViewDate(new Date(year, month - 1, 1))}
        >
          <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <TouchableOpacity
          style={styles.navBtn}
          hitSlop={8}
          onPress={() => setViewDate(new Date(year, month + 1, 1))}
        >
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((w) => (
          <View key={w} style={styles.weekCell}>
            <Text style={styles.weekText}>{w}</Text>
          </View>
        ))}
      </View>

      {Array.from({ length: cells.length / 7 }).map((_, rowIdx) => (
        <View key={rowIdx} style={styles.dayRow}>
          {cells.slice(rowIdx * 7, rowIdx * 7 + 7).map((key, ci) => {
            if (!key) return <View key={ci} style={styles.dayCell} />
            const isStart = key === startDate
            const isEnd = key === endDate
            const isSelected = isStart || isEnd
            const inRange = !!startDate && !!endDate && key > startDate && key < endDate
            const isPast = key < today
            const isToday = key === today
            const dayNum = Number(key.slice(-2))
            return (
              <TouchableOpacity
                key={ci}
                style={styles.dayCell}
                disabled={isPast}
                onPress={() => handlePress(key)}
              >
                {inRange && <View style={styles.dayFillInRange} pointerEvents="none" />}
                <View style={[
                  styles.dayCircle,
                  isSelected && styles.dayCircleSelected,
                  !isSelected && isToday && styles.dayCircleToday,
                ]}>
                  <Text style={[
                    styles.dayText,
                    isSelected && styles.dayTextSelected,
                    isPast && styles.dayTextDisabled,
                  ]}>
                    {dayNum}
                  </Text>
                </View>
              </TouchableOpacity>
            )
          })}
        </View>
      ))}

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {startDate && endDate
            ? `${startDate.slice(5).replace('-', '.')} ~ ${endDate.slice(5).replace('-', '.')}`
            : startDate
              ? `${startDate.slice(5).replace('-', '.')} ~ 종료일 선택`
              : '시작일을 선택하세요'}
        </Text>
        {(startDate || endDate) && (
          <TouchableOpacity onPress={() => onChange(null, null)} hitSlop={8}>
            <Text style={styles.clearText}>초기화</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}
