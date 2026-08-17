import TopBar from '@/components/TopBar'
import { Image } from 'expo-image'
import React, { useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Switch,
  Alert,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '@/hooks/useColors'
import { useThemeStore } from '@/stores/themeStore'
import * as Updates from 'expo-updates'

const APP_VERSION = '1.0.0'
// 2026-08-07: iOS build 8이 OTA 업데이트를 아예 못 받는 문제(채널 헤더 누락) 진단용.
// 이 줄 자체가 화면에 안 뜬다면 그 사실 자체가 "이 기기가 OTA를 못 받는다"는 증거다.
const updateInfo = `${Updates.channel ?? '없음(채널 미설정)'} · ${Updates.isEmbeddedLaunch ? '내장번들' : (Updates.updateId ?? '').slice(0, 8)}`

/**
 * 업데이트 상태 표시용.
 *
 * 예전엔 업데이트 ID 앞 8자리만 보여줬는데, 그 값만으로는 최신인지 알 수가 없었다.
 * 2026-08-17: 앱을 계속 켜둔 채로 쓰면 자동 확인(lib/appUpdates.ts)이 포그라운드
 * 전환 때만 돌아서 옛 번들 그대로였고, 오너가 그걸 모른 채 "고친 게 왜 안 보이냐"를
 * 확인하느라 시간을 썼다. 이제 이 화면에서 직접 확인하고 바로 적용할 수 있게 한다.
 */
type UpdateState =
  | { kind: 'dev' }
  | { kind: 'checking' }
  | { kind: 'latest' }
  | { kind: 'available' }
  | { kind: 'applying' }
  | { kind: 'error' }

function updateStateText(s: UpdateState): string {
  switch (s.kind) {
    case 'dev': return '개발 모드 (업데이트 없음)'
    case 'checking': return '확인 중…'
    case 'latest': return `최신입니다 · ${updateInfo}`
    case 'available': return '새 버전 있음 · 눌러서 지금 적용'
    case 'applying': return '적용 중…'
    case 'error': return `확인 실패 · ${updateInfo}`
  }
}

function SettingRow({
  iconName,
  label,
  value,
  onPress,
  danger,
  right,
}: {
  iconName: keyof typeof Ionicons.glyphMap
  label: string
  value?: string
  onPress?: () => void
  danger?: boolean
  right?: React.ReactNode
}) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      disabled={!onPress && !right}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <Ionicons name={iconName} size={20} color={danger ? colors.error : colors.textTertiary} style={styles.rowIcon} />
      <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]}>
        {label}
      </Text>
      {value && <Text style={styles.rowValue}>{value}</Text>}
      {right}
      {onPress && !right && <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />}
    </TouchableOpacity>
  )
}

export default function SettingsScreen() {
  const colors = useColors()
  const { isDark, toggle } = useThemeStore()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const handleContact = () =>
    Linking.openURL('mailto:admin@ourmine.co.kr').catch(() =>
      Alert.alert('오류', '메일 앱을 열 수 없습니다')
    )

  // 이 화면에 들어올 때마다 새 업데이트가 있는지 확인한다.
  const [updateState, setUpdateState] = useState<UpdateState>(
    __DEV__ || !Updates.isEnabled ? { kind: 'dev' } : { kind: 'checking' }
  )
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return
    let alive = true
    Updates.checkForUpdateAsync()
      .then((r) => { if (alive) setUpdateState({ kind: r.isAvailable ? 'available' : 'latest' }) })
      .catch(() => { if (alive) setUpdateState({ kind: 'error' }) })
    return () => { alive = false }
  }, [])

  /** 새 버전이 있을 때 눌러서 바로 받기 — 앱을 껐다 켤 필요 없이 그 자리에서 반영된다. */
  const applyUpdate = async () => {
    if (updateState.kind !== 'available') return
    setUpdateState({ kind: 'applying' })
    try {
      await Updates.fetchUpdateAsync()
      await Updates.reloadAsync()   // 여기서 앱이 새 번들로 다시 시작된다
    } catch {
      setUpdateState({ kind: 'error' })
      Alert.alert('업데이트 실패', '잠시 후 다시 시도해주세요.')
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
    <TopBar showBack />
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
      {/* 앱 정보 */}
      <View style={styles.appInfo}>
        <Image
          source={require('../assets/logo-stack.png')}
          style={styles.appLogo}
          contentFit="contain"
          accessibilityLabel="소개팅모아"
        />
        <Text style={styles.appDesc}>
          전국 소개팅 일정을 한눈에
        </Text>
      </View>

      {/* 화면 설정 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>화면 설정</Text>
        <SettingRow
          iconName={isDark ? 'moon' : 'sunny'}
          label={isDark ? '다크 모드' : '라이트 모드'}
          right={
            <Switch
              value={isDark}
              onValueChange={toggle}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor="#fff"
            />
          }
        />
      </View>

      {/* 서비스 안내 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>서비스 안내</Text>
        <SettingRow
          iconName="shield-checkmark-outline"
          label="개인정보처리방침"
          onPress={() => router.push('/privacy')}
        />
        <SettingRow
          iconName="document-text-outline"
          label="이용약관"
          onPress={() => router.push('/terms')}
        />
        <SettingRow
          iconName="mail-outline"
          label="제휴문의"
          value="admin@ourmine.co.kr"
          onPress={handleContact}
        />
      </View>

      {/* 앱 정보 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>앱 정보</Text>
        <SettingRow iconName="cube-outline" label="버전" value={APP_VERSION} />
        <SettingRow
          iconName="cloud-outline"
          label="업데이트 상태"
          value={updateStateText(updateState)}
          onPress={updateState.kind === 'available' ? applyUpdate : undefined}
        />
        <SettingRow
          iconName="information-circle-outline"
          label="소개팅모아 소개"
          value="전국 로테이션 소개팅 일정 모음"
        />
      </View>

      {/* 면책사항 */}
      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          소개팅모아는 각 업체의 공개된 정보를 수집·제공하는 서비스입니다.{'\n'}
          실제 신청 및 결제는 각 업체 사이트에서 진행됩니다.{'\n'}
          업체와의 분쟁에 대해 소개팅모아는 책임지지 않습니다.
        </Text>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
    </View>
  )
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    appInfo: {
      alignItems: 'center',
      paddingVertical: 32,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    // 세로형 로고(하트 위 · 글자 아래). 원본 821x644 비율 유지.
    appLogo: {
      width: 118,
      height: 118 * (644 / 821),
      marginBottom: 10,
    },
    appDesc: {
      fontSize: 13,
      color: colors.textTertiary,
    },
    section: {
      paddingTop: 20,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: 20,
      marginBottom: 4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 14,
      gap: 12,
    },
    rowIcon: { width: 28 },
    rowLabel: {
      flex: 1,
      fontSize: 15,
      color: colors.textPrimary,
    },
    rowLabelDanger: { color: colors.error },
    rowValue: {
      fontSize: 13,
      color: colors.textTertiary,
    },
    rowArrow: {
      fontSize: 20,
      color: colors.textTertiary,
    },
    disclaimer: {
      margin: 20,
      padding: 16,
      backgroundColor: colors.surface,
      borderRadius: 12,
    },
    disclaimerText: {
      fontSize: 12,
      color: colors.textTertiary,
      lineHeight: 18,
    },
  })
}
