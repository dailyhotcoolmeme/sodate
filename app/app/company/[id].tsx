import React, { useMemo, useEffect } from 'react'
import { Ionicons } from '@expo/vector-icons'
import AppSpinner from '@/components/AppSpinner'
import TopBar from '@/components/TopBar'
import BottomNav from '@/components/BottomNav'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { useCompany } from '@/hooks/useCompany'
import { useColors } from '@/hooks/useColors'
import PartnerBadge from '@/components/PartnerBadge'
import SocialLinkRow from '@/components/SocialLinkRow'
import { isPartnerCompany } from '@/lib/partner'
import EventCard from '@/components/EventCard'
import { useRefreshIndicator } from '@/hooks/useRefreshIndicator'
import { addRecentView } from '@/lib/recentViews'

function cleanText(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F000}-\u{1FFFF}]|\u200d/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export default function CompanyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, loading, error, refetch } = useCompany(id)
  const { refreshing, onRefresh } = useRefreshIndicator(loading, refetch)
  // MY '최근 본 것' 기록(2026-08-21) — 로컬 저장, 무해. 화면 노출은 MY 탭이 열릴 때부터.
  useEffect(() => {
    if (data?.company) {
      addRecentView({
        kind: 'company', id: String(id), title: cleanText(data.company.name),
        sub: data.company.regions?.join(', ') || undefined,
      })
    }
  }, [data?.company?.id])
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const colors = useColors()
  const styles = useMemo(() => StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    navHeader: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
    backBtn: { paddingVertical: 4, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2 },
    backText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      // 좌우/위쪽 시작 위치를 다른 페이지 제목들과 통일 — 이 헤더는 TopBar 바로 아래라
      // 위쪽 여백도 비교 대상(8px). 아래쪽은 로고와의 균형을 위해 기존 20 유지(2026-08-12).
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 20,
      gap: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    logo: {
      width: 60,
      height: 60,
      borderRadius: 12,
      backgroundColor: colors.surfaceHigh,
    },
    logoPlaceholder: {
      width: 60,
      height: 60,
      borderRadius: 12,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoInitial: {
      color: '#fff',
      fontSize: 24,
      fontWeight: '700',
    },
    headerInfo: { flex: 1 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    nameText: { flexShrink: 1 },
    companyName: {
      fontSize: 20,
      color: colors.textPrimary,
      fontWeight: '700',
      marginBottom: 4,
    },
    companyDesc: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
      marginBottom: 4,
    },
    companyRegions: {
      fontSize: 12,
      color: colors.textTertiary,
    },
    eventsSection: {
      paddingTop: 20,
    },
    sectionTitle: {
      fontSize: 16,
      color: colors.textPrimary,
      fontWeight: '700',
      paddingHorizontal: 20,
      marginBottom: 8,
    },
    noEvents: {
      padding: 40,
      alignItems: 'center',
    },
    noEventsText: {
      color: colors.textTertiary,
      fontSize: 14,
    },
    errorText: { color: colors.error, fontSize: 15 },
    backLink: { color: colors.primary, fontSize: 14 },
  }), [colors])

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <AppSpinner />
      </View>
    )
  }

  if (error || !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>
          {error ?? '업체를 찾을 수 없습니다'}
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>돌아가기</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const { company, events } = data

  return (
    <View style={styles.screen}>
    <TopBar showBack />
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* 업체 헤더 */}
      <View style={styles.header}>
        {company.logo_url ? (
          <Image
            source={{ uri: company.logo_url }}
            style={styles.logo}
            contentFit="contain"
          />
        ) : (
          <View style={styles.logoPlaceholder}>
            <Text style={styles.logoInitial}>{company.name[0]}</Text>
          </View>
        )}
        <View style={styles.headerInfo}>
          <View style={styles.nameRow}>
            {isPartnerCompany(company) && <PartnerBadge size="md" />}
            <Text style={[styles.companyName, styles.nameText]}>{cleanText(company.name)}</Text>
          </View>
          {/* 홈페이지·SNS — 등록된 것만 아이콘으로. 없으면 줄 자체가 안 생긴다.
              instagram_url 은 옛 컬럼이라 socials 가 비어 있을 때만 쓴다(admin 값이 우선). */}
          <SocialLinkRow
            socials={(company as any).socials}
            fallback={{ instagram: company.instagram_url }}
          />
          {company.description && (
            <Text style={styles.companyDesc} numberOfLines={2}>
              {cleanText(company.description)}
            </Text>
          )}
          {company.regions && company.regions.length > 0 && (
            <Text style={styles.companyRegions}>
              · {company.regions.join(', ')}
            </Text>
          )}
        </View>
      </View>

      {/* ⚠️ 여기 있던 버튼 줄을 통째로 없앴다(2026-09-02 오너 지시).
          '홈페이지'·'인스타그램'은 업체명 밑 아이콘 줄로 옮겼고, '알림 받기'는 제거했다.
          알림 구독은 MY → 알림 설정에서 한다(alert_subscriptions 한 곳에서만 다룬다). */}

      {/* 이벤트 목록 */}
      <View style={styles.eventsSection}>
        <Text style={styles.sectionTitle}>
          예정된 소개팅{events.length > 0 ? ` (${events.length})` : ''}
        </Text>
        {events.length === 0 ? (
          <View style={styles.noEvents}>
            <Text style={styles.noEventsText}>
              현재 예정된 일정이 없습니다
            </Text>
          </View>
        ) : (
          events.map((event) => <EventCard key={event.id} event={event} />)
        )}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
    <BottomNav current="event" route={`/company/${id}`} />
    </View>
  )
}
