import React, { useRef, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Animated,
  PanResponder,
  Dimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '@/hooks/useColors'
import type { ParticipantStats, ParticipantPerson } from '@/types/database.types'

const SCREEN_HEIGHT = Dimensions.get('window').height
const SHEET_MAX_HEIGHT = SCREEN_HEIGHT * 0.75
const DISMISS_THRESHOLD = 80

interface Props {
  visible: boolean
  onClose: () => void
  stats: ParticipantStats
}

function formatPerson(p: ParticipantPerson): string {
  const parts: string[] = []
  if (p.birth_year) {
    parts.push(`${String(p.birth_year).slice(2)}년생`)
  } else if (p.generation) {
    parts.push(p.generation)
  }
  if (p.job) parts.push(p.job)
  if (p.height) parts.push(`${p.height}cm`)
  return parts.join(' · ')
}

export default function ParticipantStatsSheet({ visible, onClose, stats }: Props) {
  const insets = useSafeAreaInsets()
  const colors = useColors()
  const translateY = useRef(new Animated.Value(SHEET_MAX_HEIGHT)).current
  const lastY = useRef(0)

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
      onPanResponderGrant: () => {
        lastY.current = 0
      },
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) {
          translateY.setValue(gs.dy)
        }
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

  const styles = StyleSheet.create({
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
      paddingBottom: insets.bottom + 16,
    },
    handleArea: {
      alignItems: 'center',
      paddingTop: 10,
      paddingBottom: 4,
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    headerTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    closeBtn: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 16,
      backgroundColor: colors.surfaceHigh,
    },
    closeBtnText: {
      fontSize: 16,
      color: colors.textSecondary,
      fontWeight: '500',
      lineHeight: 20,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 8,
    },
    genderSection: {
      marginBottom: 20,
    },
    genderHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
    },
    genderIcon: {
      fontSize: 20,
    },
    genderTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    personRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 9,
      paddingHorizontal: 14,
      backgroundColor: colors.surfaceHigh,
      borderRadius: 10,
      marginBottom: 6,
    },
    bullet: {
      width: 6,
      height: 6,
      borderRadius: 3,
      marginRight: 10,
    },
    personText: {
      fontSize: 14,
      color: colors.textSecondary,
      fontWeight: '500',
      flex: 1,
    },
    emptyText: {
      fontSize: 13,
      color: colors.textTertiary,
      textAlign: 'center',
      paddingVertical: 12,
    },
    divider: {
      height: 1,
      backgroundColor: colors.divider,
      marginVertical: 4,
      marginHorizontal: -20,
    },
    statsRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: 20,
    },
    statBox: {
      flex: 1,
      backgroundColor: colors.surfaceHigh,
      borderRadius: 12,
      padding: 14,
      alignItems: 'center',
      gap: 4,
    },
    statLabel: {
      fontSize: 12,
      color: colors.textTertiary,
      fontWeight: '500',
    },
    statValue: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    statUnit: {
      fontSize: 11,
      color: colors.textTertiary,
    },
  })

  const maleBulletColor = '#5B8BF5'
  const femaleBulletColor = '#FF6B9D'

  const hasStats =
    (stats.male && stats.male.length > 0) ||
    (stats.female && stats.female.length > 0) ||
    stats.total_count !== undefined

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={closeSheet}
      statusBarTranslucent
    >
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={closeSheet}>
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          {/* 드래그 핸들 */}
          <View {...panResponder.panHandlers}>
            <View style={styles.handleArea}>
              <View style={styles.handle} />
            </View>

            {/* 헤더 */}
            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>현재 참가자 현황</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={closeSheet} activeOpacity={0.7}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* 요약 통계 (있을 경우) */}
            {(stats.total_count !== undefined ||
              stats.seats_left_male !== undefined ||
              stats.seats_left_female !== undefined) && (
              <View style={styles.statsRow}>
                {stats.total_count !== undefined && (
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>총 참가자</Text>
                    <Text style={styles.statValue}>{stats.total_count}</Text>
                    <Text style={styles.statUnit}>명</Text>
                  </View>
                )}
                {stats.seats_left_male !== undefined && (
                  <View style={styles.statBox}>
                    <Text style={[styles.statLabel, { color: maleBulletColor }]}>남성 잔여</Text>
                    <Text style={[styles.statValue, { color: maleBulletColor }]}>
                      {stats.seats_left_male}
                    </Text>
                    <Text style={styles.statUnit}>석</Text>
                  </View>
                )}
                {stats.seats_left_female !== undefined && (
                  <View style={styles.statBox}>
                    <Text style={[styles.statLabel, { color: femaleBulletColor }]}>여성 잔여</Text>
                    <Text style={[styles.statValue, { color: femaleBulletColor }]}>
                      {stats.seats_left_female}
                    </Text>
                    <Text style={styles.statUnit}>석</Text>
                  </View>
                )}
              </View>
            )}

            {/* 남성 참가자 */}
            <View style={styles.genderSection}>
              <View style={styles.genderHeader}>
                <Text style={styles.genderIcon}>👨</Text>
                <Text style={[styles.genderTitle, { color: maleBulletColor }]}>남성 참가자</Text>
              </View>
              {stats.male && stats.male.length > 0 ? (
                stats.male.map((p, i) => (
                  <View key={i} style={styles.personRow}>
                    <View style={[styles.bullet, { backgroundColor: maleBulletColor }]} />
                    <Text style={styles.personText}>{formatPerson(p)}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyText}>참가자 정보가 없습니다</Text>
              )}
            </View>

            <View style={styles.divider} />

            {/* 여성 참가자 */}
            <View style={[styles.genderSection, { marginTop: 20 }]}>
              <View style={styles.genderHeader}>
                <Text style={styles.genderIcon}>👩</Text>
                <Text style={[styles.genderTitle, { color: femaleBulletColor }]}>여성 참가자</Text>
              </View>
              {stats.female && stats.female.length > 0 ? (
                stats.female.map((p, i) => (
                  <View key={i} style={styles.personRow}>
                    <View style={[styles.bullet, { backgroundColor: femaleBulletColor }]} />
                    <Text style={styles.personText}>{formatPerson(p)}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyText}>참가자 정보가 없습니다</Text>
              )}
            </View>
          </ScrollView>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  )
}
