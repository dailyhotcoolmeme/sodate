import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native'
import { Colors } from '@/constants/colors'

const APP_VERSION = '1.0.0'

function SettingRow({
  icon,
  label,
  value,
  onPress,
  danger,
}: {
  icon: string
  label: string
  value?: string
  onPress?: () => void
  danger?: boolean
}) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <Text style={styles.rowIcon}>{icon}</Text>
      <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]}>
        {label}
      </Text>
      {value && <Text style={styles.rowValue}>{value}</Text>}
      {onPress && <Text style={styles.rowArrow}>›</Text>}
    </TouchableOpacity>
  )
}

export default function SettingsScreen() {
  const handleOpenPrivacy = () =>
    Linking.openURL('https://sodate.app/privacy').catch(() =>
      Alert.alert('오류', '페이지를 열 수 없습니다')
    )

  const handleOpenTerms = () =>
    Linking.openURL('https://sodate.app/terms').catch(() =>
      Alert.alert('오류', '페이지를 열 수 없습니다')
    )

  const handleContact = () =>
    Linking.openURL('mailto:hello@sodate.app').catch(() =>
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

      {/* 서비스 안내 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>서비스 안내</Text>
        <SettingRow
          icon="🔒"
          label="개인정보처리방침"
          onPress={handleOpenPrivacy}
        />
        <SettingRow icon="📄" label="이용약관" onPress={handleOpenTerms} />
        <SettingRow
          icon="✉️"
          label="문의하기"
          value="hello@sodate.app"
          onPress={handleContact}
        />
      </View>

      {/* 앱 정보 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>앱 정보</Text>
        <SettingRow icon="📦" label="버전" value={APP_VERSION} />
        <SettingRow
          icon="ℹ️"
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  appInfo: {
    alignItems: 'center',
    paddingVertical: 32,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  appName: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.primary,
    marginBottom: 4,
  },
  appDesc: {
    fontSize: 13,
    color: Colors.textTertiary,
  },
  section: {
    paddingTop: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textTertiary,
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
  rowIcon: { fontSize: 18, width: 28 },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  rowLabelDanger: { color: Colors.error },
  rowValue: {
    fontSize: 13,
    color: Colors.textTertiary,
  },
  rowArrow: {
    fontSize: 20,
    color: Colors.textTertiary,
  },
  disclaimer: {
    margin: 20,
    padding: 16,
    backgroundColor: Colors.surface,
    borderRadius: 12,
  },
  disclaimerText: {
    fontSize: 12,
    color: Colors.textTertiary,
    lineHeight: 18,
  },
})
