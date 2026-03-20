import React, { useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Switch,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useColors } from '@/hooks/useColors'
import { useThemeStore } from '@/stores/themeStore'

const APP_VERSION = '1.0.0'

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

  const handleContact = () =>
    Linking.openURL('mailto:ourmine0319@gmail.com').catch(() =>
      Alert.alert('오류', '메일 앱을 열 수 없습니다')
    )

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* 앱 정보 */}
      <View style={styles.appInfo}>
        <Text style={styles.appName}>소개팅모아</Text>
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
          label="문의하기"
          value="ourmine0319@gmail.com"
          onPress={handleContact}
        />
      </View>

      {/* 앱 정보 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>앱 정보</Text>
        <SettingRow iconName="cube-outline" label="버전" value={APP_VERSION} />
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
    appName: {
      fontSize: 22,
      fontWeight: '800',
      color: colors.primary,
      marginBottom: 4,
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
