import React, { useMemo } from 'react'
import { Ionicons } from '@expo/vector-icons'
import AppSpinner from '@/components/AppSpinner'
import TopBar from '@/components/TopBar'
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
import { openOutlink } from '@/lib/outlink'
import { useColors } from '@/hooks/useColors'
import EventCard from '@/components/EventCard'
import { useRefreshIndicator } from '@/hooks/useRefreshIndicator'

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
    actions: {
      flexDirection: 'row',
      padding: 16,
      gap: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      flexWrap: 'wrap',
    },
    actionBtn: {
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 16,
      alignItems: 'center',
      borderWidth: 1,
    },
    actionBtnOutline: {
      borderColor: colors.border,
      backgroundColor: 'transparent',
    },
    actionBtnActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    actionBtnOutlineText: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    actionBtnActiveText: {
      color: '#fff',
      fontSize: 13,
      fontWeight: '700',
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
          <Text style={styles.companyName}>{cleanText(company.name)}</Text>
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

      {/* 액션 버튼들 */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnOutline]}
          onPress={() => openOutlink(company.base_url)}
        >
          <Text style={styles.actionBtnOutlineText}>홈페이지</Text>
        </TouchableOpacity>
        {company.instagram_url && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnOutline]}
            onPress={() => openOutlink(company.instagram_url!)}
          >
            <Text style={styles.actionBtnOutlineText}>인스타그램</Text>
          </TouchableOpacity>
        )}
        {/* 알림 설정 화면으로 보낸다. 예전에는 이 버튼이 기기에만 표시를 남기고 서버에는
            아무것도 보내지 않아, 'ON'으로 바뀌는 걸 보고 구독했다고 믿지만 푸시는 영영
            오지 않았다(2026-08-13 감사). 실제 구독은 alert_subscriptions 한 곳에서만 다룬다. */}
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnOutline]}
          onPress={() => router.push(`/alerts?company=${company.id}`)}
        >
          <Text style={styles.actionBtnOutlineText}>알림 받기</Text>
        </TouchableOpacity>
      </View>

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
    </View>
  )
}
