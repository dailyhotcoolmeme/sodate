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
  | { kind: 'applying' }
  | { kind: 'error' }

/**
 * 사용자에게는 상태만 말로 보여준다. 채널명·업데이트ID 같은 건 알 필요가 없다
 * (오너 지적 2026-08-17). 다만 "고친 게 왜 안 보이지"를 따질 땐 그 값이 결정적이라
 * (2026-08-17 실제로 오너가 알려준 ID로 옛 번들임을 특정했다) 길게 누르면 나오게 뒀다.
 */
function updateStateText(s: UpdateState, diag: boolean): string {
  const detail = diag ? ` · ${updateInfo}` : ''
  switch (s.kind) {
    case 'dev': return '개발 모드' + detail
    case 'checking': return '확인 중…'
    case 'latest': return '최신입니다' + detail
    case 'applying': return '새 버전 받는 중…'
    case 'error': return '확인 실패' + detail
  }
}

function SettingRow({
  iconName,
  label,
  value,
  onPress,
  onLongPress,
  danger,
  right,
}: {
  iconName: keyof typeof Ionicons.glyphMap
  label: string
  value?: string
  onPress?: () => void
  onLongPress?: () => void
  danger?: boolean
  right?: React.ReactNode
}) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress && !right}
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

  // 이 화면에 들어오면 새 버전을 확인하고, 있으면 **알아서 받아 적용**한다.
  // 사용자가 업데이트 상태를 들여다보고 눌러줄 거라 기대하면 안 된다(오너 지적 2026-08-17).
  const [updateState, setUpdateState] = useState<UpdateState>(
    __DEV__ || !Updates.isEnabled ? { kind: 'dev' } : { kind: 'checking' }
  )
  /** 길게 눌렀을 때만 채널·업데이트ID를 보여준다(문제 생겼을 때 확인용). */
  const [showDiag, setShowDiag] = useState(false)

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return
    let alive = true
    ;(async () => {
      try {
        const r = await Updates.checkForUpdateAsync()
        if (!alive) return
        if (!r.isAvailable) { setUpdateState({ kind: 'latest' }); return }
        setUpdateState({ kind: 'applying' })
        await Updates.fetchUpdateAsync()
        await Updates.reloadAsync()   // 여기서 앱이 새 번들로 다시 시작된다
      } catch {
        if (alive) setUpdateState({ kind: 'error' })
      }
    })()
    return () => { alive = false }
  }, [])

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
          accessibilityLabel="소밋"
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
          value={updateStateText(updateState, showDiag)}
          onLongPress={() => setShowDiag((v) => !v)}
        />
        <SettingRow
          iconName="information-circle-outline"
          label="소개팅모아 소개"
          value="전국 로테이션 소개팅 일정 모음"
        />
        {/* ⚠️ 라이선스 의무 표기 — 지우지 말 것.
            하단 탭바 아이콘으로 쓰는 Streamline "Flex color" 세트는 CC BY 4.0 이라
            상업적 이용은 자유지만 출처표기가 필수다. Streamline 공식 안내가 모바일 앱은
            "About/Credits 페이지에 표기"라고 정하고 있어 여기(앱 정보)에 둔다.
            아이콘 정의는 components/TabIcons.tsx 참고. */}
        <SettingRow
          iconName="color-palette-outline"
          label="아이콘 출처"
          value="Free icons from Streamline"
          onPress={() => { Linking.openURL('https://www.streamlinehq.com/icons').catch(() => {}) }}
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
    // 세로형 로고(하트 위 · 글자 아래). 원본 429x684 비율 유지.
    appLogo: {
      // 하트 크기를 예전과 같게 두려고 높이를 기준으로 잡는다(이름이 짧아져 폭만 줄었다).
      width: 118 * (429 / 821),
      height: 118 * (684 / 821),
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
    // 배경에 묻혀 아무도 안 읽던 안내라 왼쪽 핑크 줄 + 진한 글씨로 바꿨다
    // (오너 선택 2026-08-17). 인용문처럼 보여 시선이 걸린다.
    disclaimer: {
      marginHorizontal: 20,
      marginVertical: 20,
      paddingLeft: 14,
      paddingVertical: 2,
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
    },
    disclaimerText: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 20,
    },
  })
}
