import React, { useState, useMemo } from 'react'
import {
  View,
  Text,
  Switch,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
} from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '@/hooks/useColors'
import { REGIONS } from '@/constants/regions'
import { THEMES } from '@/constants/themes'
import { supabase } from '@/lib/supabase'

export default function AlertsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const colors = useColors()
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
    backBtn: { paddingVertical: 4, alignSelf: 'flex-start' },
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
    testBtn: {
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    testBtnText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  }), [colors])

  const [selectedRegions, setSelectedRegions] = useState<string[]>([])
  const [selectedThemes, setSelectedThemes] = useState<string[]>([])
  const [notifyNew, setNotifyNew] = useState(true)
  const [notifyDeadline, setNotifyDeadline] = useState(true)
  const [saving, setSaving] = useState(false)

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

  const handleTestNotification = async () => {
    const { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') {
      const { status: requested } = await Notifications.requestPermissionsAsync()
      if (requested !== 'granted') {
        Alert.alert('알림 권한 필요', '설정에서 알림 권한을 허용해주세요.',
          [{ text: '취소', style: 'cancel' }, { text: '설정 열기', onPress: () => Linking.openSettings() }]
        )
        return
      }
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '새 소개팅 등록!',
        body: '연인어때 강남 04/05(토) 일정이 등록됐어요. 마감 전에 확인하세요!',
        data: { type: 'new_event' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3 },
    })
    Alert.alert('3초 후 알림이 옵니다', '앱을 홈 화면으로 내려서 확인해보세요.')
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

      Alert.alert('저장 완료', '알림 설정이 저장되었습니다.')
    } catch (e) {
      console.error('알림 설정 저장 실패:', e)
      Alert.alert('오류', '저장 중 문제가 발생했습니다. 다시 시도해주세요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
    <View style={styles.header}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
        <Text style={styles.backText}>← 홈</Text>
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

      <TouchableOpacity style={styles.testBtn} onPress={handleTestNotification}>
        <Text style={styles.testBtnText}>테스트 알림 보내기</Text>
      </TouchableOpacity>
    </ScrollView>
    </View>
  )
}
