import React, { useState, useMemo } from 'react'
import { Ionicons } from '@expo/vector-icons'
import TopBar from '@/components/TopBar'
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
import { useRegions, type RegionOption } from '@/hooks/useRegions'
import { useHashtags } from '@/hooks/useHashtags'
import { REGION_GROUP_ORDER, regionGroupKey, TAG_GROUP_ORDER, tagGroupKey } from '@/constants/chipGroups'
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
    pageTitle: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5, marginBottom: 16 },
    summaryBox: {
      backgroundColor: colors.primary + '14', borderWidth: 1, borderColor: colors.primary + '40',
      borderRadius: 12, padding: 14, marginBottom: 20, gap: 6,
    },
    summaryHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    summaryTitle: { fontSize: 13, fontWeight: '800', color: colors.primary },
    summaryText: { fontSize: 13, lineHeight: 20, color: colors.textPrimary },
    summaryBoxEmpty: {
      backgroundColor: colors.surfaceHigh, borderRadius: 12, padding: 14, marginBottom: 20,
    },
    summaryEmptyText: { fontSize: 13, color: colors.textTertiary },
    scroll: { flex: 1 },
    content: { padding: 16, paddingBottom: 40 },
    sectionTitle: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '700',
      marginTop: 24,
      marginBottom: 4,
    },
    sectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 24,
      marginBottom: 4,
    },
    sectionTitleInline: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
    selectAllText: { fontSize: 13, fontWeight: '700', color: colors.primary },
    // 지역/태그 군: 서울 등 상위 라벨(한 줄), 그 아래 각 군은 [좌측 라벨 | 우측 칩] 행
    groupTop: { fontSize: 14, fontWeight: '800', color: colors.textPrimary, marginTop: 14, marginBottom: 2 },
    groupRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 8, gap: 8 },
    // 라벨 칸 폭 고정 → 칩 시작선이 모든 행에서 동일. 강남권 들여쓰기는 라벨 글자에만(paddingLeft).
    groupRowLabel: {
      width: 60,
      paddingLeft: 10,
      paddingTop: 7,
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    // 서울과 동급인 최상위 라벨(경기·인천·충청… + 취미/직업/유형)은 서울 글자에 맞춤
    groupRowLabelTop: { width: 60, paddingTop: 6, fontSize: 14, fontWeight: '800', color: colors.textPrimary },
    groupRowChips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    hint: { color: colors.textTertiary, fontSize: 12, marginBottom: 12 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
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

  const regionOptions = useRegions()
  const hashtagOptions = useHashtags()

  // 지역/태그 칩을 '군(群)'으로 묶어 표시(향후 크롤 값도 분류기가 자동 분류)
  const groupedRegions = useMemo(() => {
    const buckets: Record<string, RegionOption[]> = {}
    for (const r of regionOptions) (buckets[regionGroupKey(r.label)] ??= []).push(r)
    return REGION_GROUP_ORDER.filter((g) => buckets[g.key]?.length).map((g) => ({ ...g, items: buckets[g.key] }))
  }, [regionOptions])

  const groupedTags = useMemo(() => {
    const buckets: Record<string, string[]> = {}
    for (const t of hashtagOptions) (buckets[tagGroupKey(t)] ??= []).push(t)
    return TAG_GROUP_ORDER.filter((k) => buckets[k]?.length).map((k) => ({ key: k, items: buckets[k] }))
  }, [hashtagOptions])
  const [selectedRegions, setSelectedRegions] = useState<string[]>([])
  const [selectedHashtags, setSelectedHashtags] = useState<string[]>([])
  const [notifyNew, setNotifyNew] = useState(true)
  const [notifyDeadline, setNotifyDeadline] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadingExisting, setLoadingExisting] = useState(true)
  // 실제로 저장된 값만 담는다. 아래 편집 중인 값(selectedRegions 등)과 분리해 둬야
  // 저장 누르기 전에 체크만 만져도 상단 요약이 같이 흔들리지 않는다(오너 지시).
  const [savedSummary, setSavedSummary] = useState<{
    regions: string[]; hashtags: string[]; notifyNew: boolean; notifyDeadline: boolean
  } | null>(null)

  // AsyncStorage에서 로컬 설정 불러오기
  React.useEffect(() => {
    AsyncStorage.getItem(ALERT_SETTINGS_KEY).then((raw) => {
      if (raw) {
        try {
          const saved = JSON.parse(raw)
          const regions = saved.regions ?? []
          const hashtags = saved.hashtags ?? []
          const nNew = saved.notify_new ?? true
          const nDeadline = saved.notify_deadline ?? true
          setSelectedRegions(regions)
          setSelectedHashtags(hashtags)
          setNotifyNew(nNew)
          setNotifyDeadline(nDeadline)
          setSavedSummary({ regions, hashtags, notifyNew: nNew, notifyDeadline: nDeadline })
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

  const toggleHashtag = (id: string) => {
    setSelectedHashtags((prev) =>
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
          hashtags: selectedHashtags.length > 0 ? selectedHashtags : null,
          notify_new: notifyNew,
          notify_deadline: notifyDeadline,
        },
      })

      if (error) throw error

      // AsyncStorage에 로컬 저장 (다음 진입 시 즉시 복원)
      await AsyncStorage.setItem(ALERT_SETTINGS_KEY, JSON.stringify({
        regions: selectedRegions,
        hashtags: selectedHashtags,
        notify_new: notifyNew,
        notify_deadline: notifyDeadline,
      }))

      track('alert_subscribe', {
        properties: {
          regions: selectedRegions,
          hashtags: selectedHashtags,
          notify_new: notifyNew,
          notify_deadline: notifyDeadline,
        },
      })
      setSavedSummary({
        regions: selectedRegions, hashtags: selectedHashtags, notifyNew, notifyDeadline,
      })
      Alert.alert('저장 완료', describeSummary({
        regions: selectedRegions, hashtags: selectedHashtags, notifyNew, notifyDeadline,
      }, regionOptions))
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
    <View style={styles.container}>
    <TopBar showBack />
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
      <Text style={styles.pageTitle}>알림 설정</Text>

      {/* 지금 실제로 저장된 알림 상태 — 눈에 띄게(오너 지시). 아래 편집 중인 값이
          아니라 마지막으로 저장한 값만 보여준다. */}
      {savedSummary ? (
        <View style={styles.summaryBox}>
          <View style={styles.summaryHead}>
            <Ionicons name="notifications" size={15} color={colors.primary} />
            <Text style={styles.summaryTitle}>현재 알림 설정</Text>
          </View>
          <Text style={styles.summaryText}>
            {describeSummary(savedSummary, regionOptions)}
          </Text>
        </View>
      ) : (
        <View style={styles.summaryBoxEmpty}>
          <Text style={styles.summaryEmptyText}>아직 저장한 알림 설정이 없어요</Text>
        </View>
      )}

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitleInline}>관심 지역</Text>
        <TouchableOpacity
          onPress={() =>
            setSelectedRegions(
              regionOptions.length > 0 && selectedRegions.length === regionOptions.length
                ? []
                : regionOptions.map((r) => r.id)
            )
          }
          hitSlop={8}
        >
          <Text style={styles.selectAllText}>
            {regionOptions.length > 0 && selectedRegions.length === regionOptions.length ? '선택해제' : '전체선택'}
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.hint}>선택하지 않으면 전국 알림을 받습니다</Text>
      {groupedRegions.map((g, gi) => {
        const showParent = !!g.parent && (gi === 0 || groupedRegions[gi - 1].parent !== g.parent)
        return (
          <View key={g.key}>
            {showParent && <Text style={styles.groupTop}>{g.parent}</Text>}
            <View style={styles.groupRow}>
              <Text style={g.parent ? styles.groupRowLabel : styles.groupRowLabelTop}>{g.key}</Text>
              <View style={styles.groupRowChips}>
                {g.items.map((region) => (
                  <TouchableOpacity
                    key={region.id}
                    style={[styles.chip, selectedRegions.includes(region.id) && styles.chipSelected]}
                    onPress={() => toggleRegion(region.id)}
                  >
                    <Text style={[styles.chipText, selectedRegions.includes(region.id) && styles.chipTextSelected]}>
                      {region.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )
      })}

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitleInline}>관심 태그</Text>
        <TouchableOpacity
          onPress={() =>
            setSelectedHashtags(
              hashtagOptions.length > 0 && selectedHashtags.length === hashtagOptions.length
                ? []
                : [...hashtagOptions]
            )
          }
          hitSlop={8}
        >
          <Text style={styles.selectAllText}>
            {hashtagOptions.length > 0 && selectedHashtags.length === hashtagOptions.length ? '선택해제' : '전체선택'}
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.hint}>선택하지 않으면 모든 태그 알림을 받습니다</Text>
      {groupedTags.map((g) => (
        <View key={g.key} style={styles.groupRow}>
          <Text style={styles.groupRowLabelTop}>{g.key}</Text>
          <View style={styles.groupRowChips}>
            {g.items.map((tag) => (
              <TouchableOpacity
                key={tag}
                style={[styles.chip, selectedHashtags.includes(tag) && styles.chipSelected]}
                onPress={() => toggleHashtag(tag)}
              >
                <Text style={[styles.chipText, selectedHashtags.includes(tag) && styles.chipTextSelected]}>
                  {tag}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

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

/** 저장 완료 팝업과 상단 요약에 같이 쓴다 — 문구가 서로 어긋나지 않게. */
function describeSummary(
  s: { regions: string[]; hashtags: string[]; notifyNew: boolean; notifyDeadline: boolean },
  regionOptions: RegionOption[]
): string {
  const regionLabels = s.regions.length
    ? s.regions.map((id) => regionOptions.find((r) => r.id === id)?.label ?? id).join(', ')
    : '전국(지역 조건 없음)'
  const tagLabels = s.hashtags.length ? s.hashtags.join(', ') : '전체(태그 조건 없음)'
  const types = [s.notifyNew && '새 일정', s.notifyDeadline && '마감 임박(D-1)'].filter(Boolean).join(', ') || '없음'
  return `지역: ${regionLabels}\n태그: ${tagLabels}\n알림 종류: ${types}`
}
