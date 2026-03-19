import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Image } from 'expo-image'
import { openOutlink } from '@/lib/outlink'
import { Colors } from '@/constants/colors'
import type { ReviewRow } from '@/lib/supabase'

interface Props {
  review: ReviewRow & { companies?: { name: string; slug: string } | null }
  showCompany?: boolean
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
}

export default function ReviewCard({ review, showCompany = false }: Props) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => openOutlink(review.source_url)}
      activeOpacity={0.8}
    >
      {review.thumbnail_url && (
        <Image
          source={{ uri: review.thumbnail_url }}
          style={styles.thumbnail}
          contentFit="cover"
        />
      )}
      <View style={styles.body}>
        <View style={styles.header}>
          <Text style={styles.source}>{SOURCE_LABELS[review.source] ?? review.source}</Text>
          {showCompany && review.companies && (
            <Text style={styles.company}>{review.companies.name}</Text>
          )}
          {review.rating && (
            <View style={styles.ratingRow}>
              {Array.from({ length: review.rating }).map((_, i) => (
                <Text key={i} style={styles.star}>★</Text>
              ))}
            </View>
          )}
        </View>
        <Text style={styles.content} numberOfLines={4}>{review.content}</Text>
        <View style={styles.footer}>
          {review.author_name && (
            <Text style={styles.author}>{review.author_name}</Text>
          )}
          <Text style={styles.date}>{formatDate(review.published_at)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
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
    color: Colors.primary,
    fontWeight: '600',
    backgroundColor: Colors.primary + '18',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  company: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  ratingRow: { flexDirection: 'row', marginLeft: 'auto' },
  star: { fontSize: 13, color: '#FFB800' },
  content: {
    fontSize: 14,
    color: Colors.textPrimary,
    lineHeight: 21,
  },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  author: { fontSize: 12, color: Colors.textTertiary },
  date: { fontSize: 12, color: Colors.textTertiary },
})
