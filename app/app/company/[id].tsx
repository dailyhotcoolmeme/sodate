import React, { useMemo } from 'react'
import { Ionicons } from '@expo/vector-icons'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { useCompany } from '@/hooks/useCompany'
import { openOutlink } from '@/lib/outlink'
import { useAlertStore } from '@/stores/alertStore'
import { useColors } from '@/hooks/useColors'
import EventCard from '@/components/EventCard'

function cleanText(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F000}-\u{1FFFF}]|\u200d/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export default function CompanyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, loading, error } = useCompany(id)
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isSubscribed, subscribe, unsubscribe } = useAlertStore()
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
      padding: 20,
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
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
  const subscribed = isSubscribed(company.id)

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
    <View style={styles.navHeader}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
        <Ionicons name="chevron-back" size={16} color={colors.primary} /><Text style={styles.backText}>상세</Text>
      </TouchableOpacity>
    </View>
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
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
        <TouchableOpacity
          style={[
            styles.actionBtn,
            subscribed ? styles.actionBtnActive : styles.actionBtnOutline,
          ]}
          onPress={() =>
            subscribed ? unsubscribe(company.id) : subscribe(company.id)
          }
        >
          <Text
            style={
              subscribed
                ? styles.actionBtnActiveText
                : styles.actionBtnOutlineText
            }
          >
            {subscribed ? '● 알림 ON' : '○ 알림'}
          </Text>
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
