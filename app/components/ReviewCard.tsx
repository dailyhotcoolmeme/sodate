import React, { useMemo } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { openOutlink } from '@/lib/outlink'
import { useColors } from '@/hooks/useColors'
import type { ReviewRow } from '@/lib/supabase'

function cleanText(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F000}-\u{1FFFF}]|‍/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

interface Props {
  review: ReviewRow & { companies?: { name: string; slug: string } | null }
  showCompany?: boolean
  /** 이 기기에서 작성한 내 후기인지 — true면 수정/삭제 버튼 노출 */
  isMine?: boolean
  /** 소스 배지 숨김 (탭이 이미 소스를 나타낼 때) */
  hideSourceBadge?: boolean
  onEdit?: (review: ReviewRow) => void
  onDelete?: (review: ReviewRow) => void
  onReport?: (review: ReviewRow) => void
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

const SOURCE_LABELS: Record<string, string> = {
  naver_blog: '네이버 블로그',
  instagram: '인스타그램',
  kakao: '카카오',
  manual: '직접 등록',
  user: '직접 작성',
}

export default function ReviewCard({ review, showCompany = false, isMine = false, hideSourceBadge = false, onEdit, onDelete, onReport }: Props) {
  const colors = useColors()
  const isUser = review.source === 'user'
  const styles = useMemo(() => StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      marginHorizontal: 16,
      marginVertical: 6,
      overflow: 'hidden',
    },
    thumbnail: {
      width: '100%',
      height: 160,
    },
    body: { padding: 14, gap: 8 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    source: {
      fontSize: 11,
      color: colors.primary,
      fontWeight: '600',
      backgroundColor: colors.primary + '18',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 8,
    },
    company: {
      fontSize: 11.5,
      fontWeight: '700',
      color: colors.primary,
      backgroundColor: colors.primary + '1F',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 6,
      overflow: 'hidden',
    },
    ratingRow: { flexDirection: 'row', marginLeft: 'auto' },
    content: {
      fontSize: 14,
      color: colors.textPrimary,
      lineHeight: 21,
    },
    footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
    author: { fontSize: 12, color: colors.textTertiary },
    date: { fontSize: 12, color: colors.textTertiary },
    actionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
    },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    actionText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
    deleteText: { color: colors.error },
    reportText: { color: colors.textTertiary },
  }), [colors])

  const handleDelete = () => {
    Alert.alert(
      '후기 삭제',
      '이 후기를 삭제할까요? 삭제하면 되돌릴 수 없어요.',
      [
        { text: '취소', style: 'cancel' },
        { text: '삭제', style: 'destructive', onPress: () => onDelete?.(review) },
      ]
    )
  }

  // 크롤 후기는 원문 링크로, 직접 작성 후기는 링크 없음
  const pressable = !isUser && !!review.source_url
  const CardWrap: any = pressable ? TouchableOpacity : View
  const wrapProps = pressable
    ? { onPress: () => review.source_url && openOutlink(review.source_url), activeOpacity: 0.8 }
    : {}

  return (
    <CardWrap style={styles.card} {...wrapProps}>
      {review.thumbnail_url && (
        <Image
          source={{ uri: review.thumbnail_url }}
          style={styles.thumbnail}
          contentFit="cover"
        />
      )}
      <View style={styles.body}>
        <View style={styles.header}>
          {!hideSourceBadge && (
            <Text style={styles.source}>{SOURCE_LABELS[review.source] ?? review.source}</Text>
          )}
          {showCompany && review.companies && (
            <Text style={styles.company}>{review.companies.name}</Text>
          )}
          {review.rating && (
            <View style={styles.ratingRow}>
              {Array.from({ length: review.rating }).map((_, i) => (
                <Ionicons key={i} name="star" size={13} color="#FFB800" />
              ))}
            </View>
          )}
        </View>
        <Text style={styles.content} numberOfLines={pressable ? 4 : undefined}>{cleanText(review.content ?? '')}</Text>
        <View style={styles.footer}>
          {review.author_name && (
            <Text style={styles.author}>{review.author_name}</Text>
          )}
          <Text style={styles.date}>{formatDate(review.published_at)}</Text>
        </View>

        {/* 내 후기: 수정/삭제, 남의 후기: 신고 (텍스트 버튼 — 아이콘 단독 금지) */}
        {isMine ? (
          <View style={styles.actionsRow}>
            {onEdit && (
              <TouchableOpacity style={styles.actionBtn} onPress={() => onEdit(review)} hitSlop={6}>
                <Ionicons name="create-outline" size={15} color={colors.textSecondary} />
                <Text style={styles.actionText}>수정</Text>
              </TouchableOpacity>
            )}
            {onDelete && (
              <TouchableOpacity style={styles.actionBtn} onPress={handleDelete} hitSlop={6}>
                <Ionicons name="trash-outline" size={15} color={colors.error} />
                <Text style={[styles.actionText, styles.deleteText]}>삭제</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          onReport && (
            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => onReport(review)} hitSlop={6}>
                <Ionicons name="flag-outline" size={15} color={colors.textTertiary} />
                <Text style={[styles.actionText, styles.reportText]}>신고</Text>
              </TouchableOpacity>
            </View>
          )
        )}
      </View>
    </CardWrap>
  )
}
