import React, { useState, useMemo } from 'react'
import { Ionicons } from '@expo/vector-icons'
import {
  View,
  Text,
  Switch,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  Platform,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '@/hooks/useColors'
import { REGIONS } from '@/constants/regions'
import { THEMES } from '@/constants/themes'
import { supabase } from '@/lib/supabase'
import { track } from '@/lib/analytics'

const ALERT_SETTINGS_KEY = 'sodate-alert-settings'

export default function AlertsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const colors = useColors()
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
    backBtn: { paddingVertical: 4, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2 },
    backText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
    headerTitle: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5, marginTop: 4 },
    scroll: { flex: 1 },
    content: { padding: 16, paddingBottom: 40 },
    sectionTitle: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '700',
      marginTop: 24,
      marginBottom: 4,
    },
    hint: { color: colors.textTertiary, fontSize: 12, marginBottom: 12 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.textSecondary, fontSize: 13 },
    chipTextSelected: { color: '#fff', fontWeight: '600' },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    label: { color: colors.textPrimary, fontSize: 15 },
    subLabel: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
    saveBtn: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: 32,
    },
    saveBtnDisabled: { opacity: 0.6 },
    saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  }), [colors])

  const [selectedRegions, setSelectedRegions] = useState<string[]>([])
  const [selectedThemes, setSelectedThemes] = useState<string[]>([])
  const [notifyNew, setNotifyNew] = useState(true)
  const [notifyDeadline, setNotifyDeadline] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadingExisting, setLoadingExisting] = useState(true)

  // AsyncStorage에서 로컬 설정 불러오기
  React.useEffect(() => {
    AsyncStorage.getItem(ALERT_SETTINGS_KEY).then((raw) => {
      if (raw) {
        try {
          const saved = JSON.parse(raw)
          setSelectedRegions(saved.regions ?? [])
          setSelectedThemes(saved.themes ?? [])
          setNotifyNew(saved.notify_new ?? true)
          setNotifyDeadline(saved.notify_deadline ?? true)
        } catch {}
      }
      setLoadingExisting(false)
    })
  }, [])

  const toggleRegion = (id: string) => {
    setSelectedRegions((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    )
  }

  const toggleTheme = (id: string) => {
    setSelectedThemes((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    )
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      let { status } = await Notifications.getPermissionsAsync()
      if (status !== 'granted') {
        const { status: requested } = await Notifications.requestPermissionsAsync()
        if (requested !== 'granted') {
          Alert.alert(
            '알림 권한 필요',
            '알림을 받으려면 설정에서 권한을 허용해주세요.',
            [
              { text: '취소', style: 'cancel' },
              { text: '설정 열기', onPress: () => Linking.openSettings() },
            ]
          )
          return
        }
        status = requested
      }

      if (!Device.isDevice) {
        Alert.alert('시뮬레이터 제한', '실제 기기에서만 알림 구독 저장이 가능합니다.')
        return
      }

      const tokenResult = await Notifications.getExpoPushTokenAsync({
        projectId: Constants.expoConfig?.extra?.eas?.projectId,
      })

      // 토큰이 DB에 없을 수 있으므로 먼저 등록
      await supabase.functions.invoke('register-push-token', {
        body: { token: tokenResult.data, platform: Platform.OS },
      })

      const { error } = await supabase.functions.invoke('save-alert-subscription', {
        body: {
          token: tokenResult.data,
          regions: selectedRegions.length > 0 ? selectedRegions : null,
          themes: selectedThemes.length > 0 ? selectedThemes : null,
          notify_new: notifyNew,
          notify_deadline: notifyDeadline,
        },
      })

      if (error) throw error

      // AsyncStorage에 로컬 저장 (다음 진입 시 즉시 복원)
      await AsyncStorage.setItem(ALERT_SETTINGS_KEY, JSON.stringify({
        regions: selectedRegions,
        themes: selectedThemes,
        notify_new: notifyNew,
        notify_deadline: notifyDeadline,
      }))

      track('alert_subscribe', {
        properties: {
          regions: selectedRegions,
          themes: selectedThemes,
          notify_new: notifyNew,
          notify_deadline: notifyDeadline,
        },
      })
      Alert.alert('저장 완료', '알림 설정이 저장되었습니다.')
    } catch (e) {
      console.error('알림 설정 저장 실패:', e)
      Alert.alert('오류', '저장 중 문제가 발생했습니다. 다시 시도해주세요.')
    } finally {
      setSaving(false)
    }
  }

  if (loadingExisting) return (
    <View style={[styles.container, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: colors.textTertiary, fontSize: 14 }}>설정 불러오는 중...</Text>
    </View>
  )

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
    <View style={styles.header}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
        <Ionicons name="chevron-back" size={16} color={colors.primary} /><Text style={styles.backText}>홈</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>알림 설정</Text>
    </View>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>관심 지역</Text>
      <Text style={styles.hint}>선택하지 않으면 전국 알림을 받습니다</Text>
      <View style={styles.chipRow}>
        {REGIONS.filter((r) => r.id !== 'all').map((region) => (
          <TouchableOpacity
            key={region.id}
            style={[styles.chip, selectedRegions.includes(region.id) && styles.chipSelected]}
            onPress={() => toggleRegion(region.id)}
          >
            <Text
              style={[
                styles.chipText,
                selectedRegions.includes(region.id) && styles.chipTextSelected,
              ]}
            >
              {region.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionTitle}>관심 테마</Text>
      <Text style={styles.hint}>선택하지 않으면 모든 테마 알림을 받습니다</Text>
      <View style={styles.chipRow}>
        {THEMES.map((theme) => (
          <TouchableOpacity
            key={theme.id}
            style={[styles.chip, selectedThemes.includes(theme.id) && styles.chipSelected]}
            onPress={() => toggleTheme(theme.id)}
          >
            <Text
              style={[
                styles.chipText,
                selectedThemes.includes(theme.id) && styles.chipTextSelected,
              ]}
            >
              {theme.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionTitle}>알림 종류</Text>
      <View style={styles.row}>
        <View>
          <Text style={styles.label}>새 일정 알림</Text>
          <Text style={styles.subLabel}>조건에 맞는 새 소개팅이 등록되면 알림</Text>
        </View>
        <Switch
          value={notifyNew}
          onValueChange={setNotifyNew}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor="#fff"
        />
      </View>
      <View style={styles.row}>
        <View>
          <Text style={styles.label}>마감 임박 알림 (D-1)</Text>
          <Text style={styles.subLabel}>관심 일정 마감 하루 전 알림</Text>
        </View>
        <Switch
          value={notifyDeadline}
          onValueChange={setNotifyDeadline}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor="#fff"
        />
      </View>

      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        <Text style={styles.saveBtnText}>{saving ? '저장 중...' : '알림 설정 저장'}</Text>
      </TouchableOpacity>

    </ScrollView>
    </View>
  )
}
