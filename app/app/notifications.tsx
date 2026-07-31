import React, { useEffect, useMemo } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, RefreshControl } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AppSpinner from '@/components/AppSpinner'
import TopBar from '@/components/TopBar'
import { useColors } from '@/hooks/useColors'
import { useNotifications, type NotificationRow } from '@/hooks/useNotifications'
import { openOutlink } from '@/lib/outlink'
import { useRefreshIndicator } from '@/hooks/useRefreshIndicator'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}일 전`
  const dt = new Date(iso)
  return `${dt.getMonth() + 1}월 ${dt.getDate()}일`
}

export default function NotificationsScreen() {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { items, loading, refetch, markAllRead, deleteOne, deleteAll } = useNotifications()
  // 당김 표시는 다른 앱처럼 잠깐 붙잡아 둔다(거리는 iOS 기본값 그대로)
  const { refreshing, onRefresh } = useRefreshIndicator(loading, refetch)

  // 진입 시 모두 읽음 처리
  useEffect(() => {
    markAllRead()
  }, [markAllRead])

  const styles = useMemo(() => makeStyles(colors), [colors])

  const onPress = (n: NotificationRow) => {
    if (n.event_id) router.push(`/event/${n.event_id}`)
    else if (n.source_url) openOutlink(n.source_url)
  }

  const confirmDeleteOne = (n: NotificationRow) => {
    Alert.alert('알림 삭제', '이 알림을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => deleteOne(n.id) },
    ])
  }

  const confirmDeleteAll = () => {
    Alert.alert('알림 전체 삭제', '받은 알림 내역을 모두 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '전체 삭제', style: 'destructive', onPress: deleteAll },
    ])
  }

  return (
    <View style={styles.container}>
      <TopBar showBack />
      <View style={styles.header}>
        <Text style={styles.title}>알림</Text>
        {items.length > 0 && (
          <TouchableOpacity onPress={confirmDeleteAll} hitSlop={8}>
            <Text style={styles.clearAll}>전체 삭제</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.center}>
          <AppSpinner />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="notifications-off-outline" size={34} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>받은 알림이 없어요</Text>
          <Text style={styles.emptySub}>관심 지역·태그를 설정하면 새 소개팅 알림을 받아요</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/alerts')} activeOpacity={0.85}>
            <Text style={styles.emptyBtnText}>알림 설정하기</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {items.map((n) => (
            <TouchableOpacity
              key={n.id}
              style={[styles.row, !n.read && styles.rowUnread]}
              activeOpacity={n.event_id || n.source_url ? 0.7 : 1}
              onPress={() => onPress(n)}
              onLongPress={() => confirmDeleteOne(n)}
              delayLongPress={350}
            >
              <View style={styles.iconWrap}>
                <Ionicons name="heart" size={18} color={colors.primary} />
                {!n.read && <View style={styles.dot} />}
              </View>
              <View style={styles.rowText}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {n.title ?? '소개팅모아'}
                  </Text>
                  <Text style={styles.time}>{timeAgo(n.created_at)}</Text>
                </View>
                <Text style={styles.rowBody} numberOfLines={2}>
                  {n.body}
                </Text>
                {!!n.company_name && <Text style={styles.company}>{n.company_name}</Text>}
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 12,
    },
    title: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
    clearAll: { fontSize: 13, fontWeight: '700', color: colors.textTertiary },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
    emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginTop: 4 },
    emptySub: { fontSize: 13, color: colors.textTertiary, textAlign: 'center' },
    emptyBtn: { marginTop: 14, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22 },
    emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    row: {
      flexDirection: 'row',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 15,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    rowUnread: { backgroundColor: colors.primary + '0D' },
    iconWrap: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.primary + '1A',
      alignItems: 'center',
      justifyContent: 'center',
    },
    dot: {
      position: 'absolute',
      top: 0,
      right: 0,
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.primary,
      borderWidth: 2,
      borderColor: colors.background,
    },
    rowText: { flex: 1, gap: 3 },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    rowTitle: { fontSize: 14, fontWeight: '700', color: colors.primary, flexShrink: 1 },
    time: { fontSize: 11, color: colors.textTertiary },
    rowBody: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
    company: { fontSize: 12, color: colors.textTertiary },
  })
}
