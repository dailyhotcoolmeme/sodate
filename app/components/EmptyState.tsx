import React, { useMemo } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useColors } from '@/hooks/useColors'
import { useFilterStore } from '@/stores/filterStore'

export default function EmptyState({ error, onRetry }: { error?: string | null; onRetry?: () => void } = {}) {
  const resetFilters = useFilterStore((s) => s.resetFilters)
  const colors = useColors()
  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 80,
      paddingHorizontal: 32,
    },
    emoji: {
      fontSize: 48,
      marginBottom: 16,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: 24,
    },
    btn: {
      backgroundColor: colors.surfaceHigh,
      borderRadius: 10,
      paddingHorizontal: 24,
      paddingVertical: 12,
    },
    btnText: {
      color: colors.textPrimary,
      fontWeight: '600',
      fontSize: 14,
    },
  }), [colors])

  // 네트워크 실패 등 오류 — "빈 목록"과 구분해 재시도 제공
  if (error) {
    return (
      <View style={styles.container}>
        <Ionicons name="cloud-offline-outline" size={48} color={colors.textTertiary} style={{ marginBottom: 16 }} />
        <Text style={styles.title}>불러오지 못했어요</Text>
        <Text style={styles.subtitle}>네트워크 상태를 확인하고{'\n'}다시 시도해 주세요</Text>
        {onRetry && (
          <TouchableOpacity style={styles.btn} onPress={onRetry}>
            <Text style={styles.btnText}>다시 시도</Text>
          </TouchableOpacity>
        )}
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Ionicons name="bookmark" size={48} color="#FF6B9D" style={{ marginBottom: 16 }} />
      <Text style={styles.title}>조건에 맞는 소개팅이 없어요</Text>
      <Text style={styles.subtitle}>
        필터를 변경하거나 다른 지역을 선택해보세요
      </Text>
      <TouchableOpacity style={styles.btn} onPress={resetFilters}>
        <Text style={styles.btnText}>필터 초기화</Text>
      </TouchableOpacity>
    </View>
  )
}
