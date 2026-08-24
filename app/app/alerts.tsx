import React, { useState, useMemo } from 'react'
import { Ionicons } from '@expo/vector-icons'
import TopBar from '@/components/TopBar'
import LoadingOverlay from '@/components/LoadingOverlay'
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
import { useLocalSearchParams } from 'expo-router'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '@/hooks/useColors'
import { useRegions, type RegionOption } from '@/hooks/useRegions'
import { useHashtags } from '@/hooks/useHashtags'
import { useCompanies } from '@/hooks/useCompanies'
import { REGION_GROUP_ORDER, regionGroupKey, TAG_GROUP_ORDER, tagGroupKey } from '@/constants/chipGroups'
import { SOCIALING_GROUPS } from '@/constants/socialingCategories'
import { supabase } from '@/lib/supabase'
import { track } from '@/lib/analytics'
import { useCollapseStore } from '@/stores/collapseStore'
import CollapsibleSection from '@/components/CollapsibleSection'

const ALERT_SETTINGS_KEY = 'sodate-alert-settings'          // 소개팅(기존 키 유지 — 기존 사용자 설정 보존)
const ALERT_SETTINGS_KEY_SOC = 'sodate-alert-settings-socialing'  // 소셜링
const alertKeyFor = (t: 'dating' | 'socialing') => (t === 'socialing' ? ALERT_SETTINGS_KEY_SOC : ALERT_SETTINGS_KEY)

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
    summaryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    summaryHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    summaryTitle: { fontSize: 13, fontWeight: '800', color: colors.primary },
    summaryText: { fontSize: 13, lineHeight: 20, color: colors.textPrimary },
    unsubscribeText: { fontSize: 12.5, fontWeight: '700', color: colors.textSecondary },
    summaryBoxEmpty: {
      backgroundColor: colors.surfaceHigh, borderRadius: 12, padding: 14, marginBottom: 20,
    },
    summaryEmptyText: { fontSize: 13, color: colors.textTertiary },
    scroll: { flex: 1 },
    // 제목 위쪽 여백을 다른 페이지들과 통일(8px) — 여기만 16이라 위쪽 시작 위치가 어긋나 있었다(2026-08-12).
    content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
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
    toggleAllRow: { alignItems: 'flex-end', marginBottom: 8 },
    toggleAllText: { fontSize: 13, fontWeight: '700', color: colors.primary },
    sectionActionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
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
    // 지역 군 라벨(강남권 등)을 누르면 그 안의 칩이 한번에 선택된다 — 다 선택되면 강조색.
    groupRowLabelActive: { color: colors.primary },
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
    // 소개팅/소셜링 탭 — 혼술바(피드·지도)와 동일한 밑줄 탭 규격. 새로 만들지 않는다.
    alertTabs: {
      flexDirection: 'row', alignItems: 'flex-end', gap: 18,
      borderBottomWidth: 1, borderBottomColor: colors.divider, marginBottom: 16,
    },
    alertTab: { paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    alertTabOn: { borderBottomColor: colors.primary },
    alertTabText: { fontSize: 15, fontWeight: '700', color: colors.textTertiary },
    alertTabTextOn: { color: colors.textPrimary, fontWeight: '800' },
  }), [colors])

  const regionOptions = useRegions()
  const hashtagOptions = useHashtags()
  const companyOptions = useCompanies()

  // 섹션별 접기·펼치기 — 기기에 저장돼 다음에 열어도 마지막 상태 유지(오너 지시 2026-08-12).
  const sectionExpanded = useCollapseStore((s) => s.expanded)
  const toggleSection = useCollapseStore((s) => s.toggle)
  const setManyExpanded = useCollapseStore((s) => s.setMany)
  const sectionKeys = useMemo(() => {
    const keys = ['region', 'hashtag']
    if (companyOptions.length > 0) keys.push('company')
    return keys.map((k) => `alerts:${k}`)
  }, [companyOptions.length])
  const allExpanded = sectionKeys.length > 0 && sectionKeys.every((k) => sectionExpanded[k])
  const toggleAllSections = () => setManyExpanded(sectionKeys, !allExpanded)

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
  // 소개팅/소셜링 탭 — 한 기기가 둘을 따로 구독한다(서버는 (token,event_type) 로 각각 저장).
  const [alertTab, setAlertTab] = useState<'dating' | 'socialing'>('dating')
  const isSoc = alertTab === 'socialing'
  const [selectedRegions, setSelectedRegions] = useState<string[]>([])
  const [selectedHashtags, setSelectedHashtags] = useState<string[]>([])
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([])
  // 소셜링 전용: 카테고리 그룹(독서·영화·운동…)
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  // 신규 진입 시 기본은 꺼짐 — 사용자가 직접 켜야 한다(오너 지시 2026-08-11).
  const [notifyNew, setNotifyNew] = useState(false)
  const [notifyDeadline, setNotifyDeadline] = useState(false)
  const [saving, setSaving] = useState(false)
  const [unsubscribing, setUnsubscribing] = useState(false)
  const [loadingExisting, setLoadingExisting] = useState(true)
  // 실제로 저장된 값만 담는다. 아래 편집 중인 값(selectedRegions 등)과 분리해 둬야
  // 저장 누르기 전에 체크만 만져도 상단 요약이 같이 흔들리지 않는다(오너 지시).
  const [savedSummary, setSavedSummary] = useState<{
    regions: string[]; hashtags: string[]; companies: string[]; notifyNew: boolean; notifyDeadline: boolean
  } | null>(null)

  // AsyncStorage에서 로컬 설정 불러오기 — 탭(소개팅/소셜링)마다 따로 저장·복원한다.
  React.useEffect(() => {
    setLoadingExisting(true)
    AsyncStorage.getItem(alertKeyFor(alertTab)).then((raw) => {
      // 탭 전환 시 이전 탭 값이 남지 않게 초기화부터
      setSelectedRegions([]); setSelectedHashtags([]); setSelectedCompanies([]); setSelectedGroups([])
      setNotifyNew(false); setNotifyDeadline(false); setSavedSummary(null)
      if (raw) {
        try {
          const saved = JSON.parse(raw)
          const regions = saved.regions ?? []
          const hashtags = saved.hashtags ?? []
          const companies = saved.company_ids ?? []
          const nNew = saved.notify_new ?? false
          const nDeadline = saved.notify_deadline ?? false
          setSelectedRegions(regions)
          setSelectedHashtags(hashtags)
          setSelectedCompanies(companies)
          setNotifyNew(nNew)
          setNotifyDeadline(nDeadline)
          setSelectedGroups(saved.socialing_groups ?? [])
          setSavedSummary({ regions, hashtags, companies, notifyNew: nNew, notifyDeadline: nDeadline })
        } catch {}
      }
      setLoadingExisting(false)
    })
  }, [alertTab])

  // 업체 상세에서 '알림 받기'로 넘어온 경우 그 업체를 미리 골라 둔다. 저장은 사용자가
  // 직접 눌러야 한다 — 넘어오자마자 저장해 버리면 본인이 뭘 켰는지 모르게 된다.
  // (예전엔 업체 상세 버튼이 기기에만 표시를 남기고 서버에는 아무것도 안 보내서,
  //  구독한 줄 알지만 푸시가 영영 안 오는 상태였다. 2026-08-13 감사)
  const { company: presetCompany } = useLocalSearchParams<{ company?: string }>()
  React.useEffect(() => {
    if (!presetCompany || loadingExisting) return
    setSelectedCompanies((prev) => (prev.includes(presetCompany) ? prev : [...prev, presetCompany]))
    setNotifyNew(true)
  }, [presetCompany, loadingExisting])

  const toggleRegion = (id: string) => {
    setSelectedRegions((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    )
  }

  // 지역 군(강남권 등) 라벨을 누르면 그 안의 지역 전체를 한번에 선택/해제한다
  // (2026-08-02 오너 지적: 강남권 하나 걸려고 안에 있는 칩을 다 눌러야 했다).
  const toggleRegionGroup = (ids: string[]) => {
    const allOn = ids.length > 0 && ids.every((id) => selectedRegions.includes(id))
    setSelectedRegions((prev) =>
      allOn ? prev.filter((id) => !ids.includes(id)) : Array.from(new Set([...prev, ...ids]))
    )
  }

  const toggleHashtag = (id: string) => {
    setSelectedHashtags((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    )
  }

  const toggleCompany = (id: string) => {
    setSelectedCompanies((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
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
          company_ids: selectedCompanies.length > 0 ? selectedCompanies : null,
          notify_new: notifyNew,
          notify_deadline: notifyDeadline,
          event_type: alertTab,
          socialing_groups: isSoc && selectedGroups.length > 0 ? selectedGroups : null,
        },
      })

      if (error) throw error

      // AsyncStorage에 로컬 저장 (다음 진입 시 즉시 복원)
      await AsyncStorage.setItem(alertKeyFor(alertTab), JSON.stringify({
        regions: selectedRegions,
        hashtags: selectedHashtags,
        company_ids: selectedCompanies,
        socialing_groups: selectedGroups,
        notify_new: notifyNew,
        notify_deadline: notifyDeadline,
      }))

      track('alert_subscribe', {
        properties: {
          regions: selectedRegions,
          hashtags: selectedHashtags,
          company_ids: selectedCompanies,
          notify_new: notifyNew,
          notify_deadline: notifyDeadline,
          event_type: alertTab,
          socialing_groups: isSoc && selectedGroups.length > 0 ? selectedGroups : null,
        },
      })
      setSavedSummary({
        regions: selectedRegions, hashtags: selectedHashtags, companies: selectedCompanies, notifyNew, notifyDeadline,
      })
      // 팝업엔 조건을 전부 나열하지 않는다 — 조건이 많으면 팝업이 지저분해진다(오너 지시).
      // 자세한 조건은 저장 후 상단 요약 박스에서 확인.
      Alert.alert('저장 완료', '알림이 설정되었습니다.')
    } catch (e) {
      console.error('알림 설정 저장 실패:', e)
      Alert.alert('오류', '저장 중 문제가 발생했습니다. 다시 시도해주세요.')
    } finally {
      setSaving(false)
    }
  }

  // 알림 해제 — 서버 구독 행을 비활성화한다(match-subscriptions가 is_active=true만 본다).
  // 필터칩 선택 상태도 같이 초기화한다 — 해제했는데 칩 색이 그대로 남아있으면
  // 여전히 켜져 있는 것처럼 보여 혼란스럽다(오너 지시 2026-08-11).
  const handleUnsubscribe = () => {
    Alert.alert(
      '알림 해제',
      '저장된 알림 설정을 끌까요? 조건 선택도 함께 초기화됩니다.',
      [
        { text: '취소', style: 'cancel' },
        { text: '해제', style: 'destructive', onPress: doUnsubscribe },
      ]
    )
  }

  const doUnsubscribe = async () => {
    setUnsubscribing(true)
    try {
      if (!Device.isDevice) {
        Alert.alert('시뮬레이터 제한', '실제 기기에서만 가능합니다.')
        return
      }
      // ⚠️ 알림 권한이 꺼져 있어도 서버 구독은 반드시 해제해야 한다. 예전에는 권한이
      //    granted 일 때만 서버에 알리고 아니면 기기 저장값만 지운 뒤 성공 처리했다.
      //    그러면 서버 구독은 is_active=true 로 살아 있어서, 나중에 OS 알림을 다시 켜는
      //    순간 "해제했다고 믿었던" 푸시가 다시 왔다. 게다가 화면에서는 이미 설정이
      //    사라져 해제 버튼조차 없어 끌 방법이 없었다(2026-08-13 감사).
      //    토큰은 권한과 무관하게 발급되므로 그대로 요청한다.
      let serverCleared = false
      try {
        const tokenResult = await Notifications.getExpoPushTokenAsync({
          projectId: Constants.expoConfig?.extra?.eas?.projectId,
        })
        const { error } = await supabase.functions.invoke('save-alert-subscription', {
          body: { token: tokenResult.data, unsubscribe: true },
        })
        if (error) throw error
        serverCleared = true
      } catch (e) {
        // 토큰을 못 받는 경우(권한 거부 상태의 일부 기기 등)까지 실패로 몰면 사용자가
        // 화면에서 설정을 지울 수조차 없다. 기기 쪽은 지우되 사실대로 알린다.
        console.error('서버 구독 해제 실패:', e)
      }
      if (!serverCleared) {
        Alert.alert(
          '일부만 해제되었습니다',
          '이 기기의 알림 설정은 지웠지만 서버 구독 해제에 실패했습니다. 네트워크가 연결된 상태에서 다시 한 번 해제해 주세요.'
        )
      }
      await AsyncStorage.removeItem(ALERT_SETTINGS_KEY)
      setSavedSummary(null)
      setSelectedRegions([])
      setSelectedHashtags([])
      setSelectedCompanies([])
      setNotifyNew(false)
      setNotifyDeadline(false)
      track('alert_unsubscribe')
    } catch (e) {
      console.error('알림 해제 실패:', e)
      Alert.alert('오류', '해제 중 문제가 발생했습니다. 다시 시도해주세요.')
    } finally {
      setUnsubscribing(false)
    }
  }

  if (loadingExisting) return (
    <View style={[styles.container, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: colors.textTertiary, fontSize: 14 }}>설정 불러오는 중...</Text>
    </View>
  )

  return (
    <View style={styles.container}>
    <TopBar showBack title="알림 설정" />
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>

      {/* 소개팅 / 소셜링 — 각각 따로 구독한다(2026-08-24 오너 지시) */}
      <View style={styles.alertTabs}>
        {(['dating', 'socialing'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.alertTab, alertTab === t && styles.alertTabOn]}
            onPress={() => setAlertTab(t)}
            activeOpacity={0.8}
          >
            <Text style={[styles.alertTabText, alertTab === t && styles.alertTabTextOn]}>
              {t === 'dating' ? '소개팅' : '소셜링'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 지금 실제로 저장된 알림 상태 — 눈에 띄게(오너 지시). 아래 편집 중인 값이
          아니라 마지막으로 저장한 값만 보여준다. */}
      {savedSummary ? (
        <View style={styles.summaryBox}>
          <View style={styles.summaryHead}>
            <View style={styles.summaryHeadLeft}>
              <Ionicons name="notifications" size={15} color={colors.primary} />
              <Text style={styles.summaryTitle}>현재 알림 설정</Text>
            </View>
            <TouchableOpacity onPress={handleUnsubscribe} disabled={unsubscribing} hitSlop={8}>
              <Text style={styles.unsubscribeText}>알림 해제</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.summaryText}>
            {describeSummaryCompact(savedSummary, regionOptions, companyOptions)}
          </Text>
        </View>
      ) : (
        <View style={styles.summaryBoxEmpty}>
          <Text style={styles.summaryEmptyText}>아직 저장한 알림 설정이 없어요</Text>
        </View>
      )}

      {/* 전체 접기/펼치기 — 섹션이 많아 리스트가 길어지는 걸 완화(오너 지시 2026-08-12) */}
      <View style={styles.toggleAllRow}>
        <TouchableOpacity onPress={toggleAllSections} hitSlop={8}>
          <Text style={styles.toggleAllText}>{allExpanded ? '전체 접기' : '전체 펼치기'}</Text>
        </TouchableOpacity>
      </View>

      <CollapsibleSection
        title="관심 지역"
        expanded={!!sectionExpanded['alerts:region']}
        onToggle={() => toggleSection('alerts:region')}
      >
        <View style={styles.sectionActionRow}>
          <Text style={styles.hint}>선택하지 않으면 전국 알림을 받습니다</Text>
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
        {groupedRegions.map((g, gi) => {
          const showParent = !!g.parent && (gi === 0 || groupedRegions[gi - 1].parent !== g.parent)
          const groupIds = g.items.map((r) => r.id)
          const groupAllOn = groupIds.length > 0 && groupIds.every((id) => selectedRegions.includes(id))
          return (
            <View key={g.key}>
              {showParent && <Text style={styles.groupTop}>{g.parent}</Text>}
              <View style={styles.groupRow}>
                <TouchableOpacity onPress={() => toggleRegionGroup(groupIds)} hitSlop={6}>
                  <Text style={[g.parent ? styles.groupRowLabel : styles.groupRowLabelTop, groupAllOn && styles.groupRowLabelActive]}>
                    {g.key}
                  </Text>
                </TouchableOpacity>
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
      </CollapsibleSection>

      {/* 소셜링 탭: 카테고리(독서·영화·운동…) — 소개팅의 태그 자리를 대신한다 */}
      {isSoc && (
        <CollapsibleSection
          title="관심 카테고리"
          expanded={!!sectionExpanded['alerts:hashtag']}
          onToggle={() => toggleSection('alerts:hashtag')}
        >
          <Text style={styles.hint}>선택하지 않으면 모든 카테고리 알림을 받습니다</Text>
          <View style={styles.chipRow}>
            {SOCIALING_GROUPS.map((g) => {
              const on = selectedGroups.includes(g.key)
              return (
                <TouchableOpacity
                  key={g.key}
                  style={[styles.chip, on && styles.chipSelected]}
                  onPress={() => setSelectedGroups((prev) => (on ? prev.filter((k) => k !== g.key) : [...prev, g.key]))}
                >
                  <Text style={[styles.chipText, on && styles.chipTextSelected]}>{g.label}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </CollapsibleSection>
      )}

      {!isSoc && (
      <CollapsibleSection
        title="관심 태그"
        expanded={!!sectionExpanded['alerts:hashtag']}
        onToggle={() => toggleSection('alerts:hashtag')}
      >
        <View style={styles.sectionActionRow}>
          <Text style={styles.hint}>선택하지 않으면 모든 태그 알림을 받습니다</Text>
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
      </CollapsibleSection>
      )}

      {!isSoc && companyOptions.length > 0 && (
        <CollapsibleSection
          title="관심 업체"
          expanded={!!sectionExpanded['alerts:company']}
          onToggle={() => toggleSection('alerts:company')}
        >
          <View style={styles.sectionActionRow}>
            <Text style={styles.hint}>선택하지 않으면 모든 업체 알림을 받습니다</Text>
            <TouchableOpacity
              onPress={() =>
                setSelectedCompanies(
                  companyOptions.length > 0 && selectedCompanies.length === companyOptions.length
                    ? []
                    : companyOptions.map((c) => c.id)
                )
              }
              hitSlop={8}
            >
              <Text style={styles.selectAllText}>
                {companyOptions.length > 0 && selectedCompanies.length === companyOptions.length ? '선택해제' : '전체선택'}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.chipRow}>
            {companyOptions.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.chip, selectedCompanies.includes(c.id) && styles.chipSelected]}
                onPress={() => toggleCompany(c.id)}
              >
                <Text style={[styles.chipText, selectedCompanies.includes(c.id) && styles.chipTextSelected]}>
                  {c.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </CollapsibleSection>
      )}

      <Text style={styles.sectionTitle}>알림 종류</Text>
      <View style={styles.row}>
        <View>
          <Text style={styles.label}>새 일정 알림</Text>
          <Text style={styles.subLabel}>조건에 맞는 새 {isSoc ? '소셜링' : '소개팅'}이 등록되면 알림 (매일 오전 8시·오후 8시)</Text>
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
          <Text style={styles.subLabel}>관심 {isSoc ? '모임' : '일정'} 마감 하루 전 알림 (매일 오후 8시경)</Text>
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
        <Text style={styles.saveBtnText}>알림 설정 저장</Text>
      </TouchableOpacity>

    </ScrollView>
    <LoadingOverlay visible={saving || unsubscribing} />
    </View>
  )
}

/** 상단 "현재 알림 설정" 요약 — 조건(지역+태그+업체)이 많으면 전부 나열하지 않고
 * "OO 외 N개 조건"으로 압축한다(오너 지시: 조건 많을 때 지저분해 보임 방지). */
function describeSummaryCompact(
  s: { regions: string[]; hashtags: string[]; companies: string[]; notifyNew: boolean; notifyDeadline: boolean },
  regionOptions: RegionOption[],
  companyOptions: { id: string; name: string }[]
): string {
  const regionLabels = s.regions.map((id) => regionOptions.find((r) => r.id === id)?.label ?? id)
  const companyLabels = s.companies.map((id) => companyOptions.find((c) => c.id === id)?.name ?? id)
  const allConditions = [...regionLabels, ...s.hashtags, ...companyLabels]

  const conditionText =
    allConditions.length === 0 ? '전체(조건 없음)'
    : allConditions.length === 1 ? allConditions[0]
    : `${allConditions[0]} 외 ${allConditions.length - 1}개 조건`

  const types = [s.notifyNew && '새 일정', s.notifyDeadline && '마감 임박'].filter(Boolean).join('·') || '없음'
  return `${conditionText} · ${types} 알림`
}
