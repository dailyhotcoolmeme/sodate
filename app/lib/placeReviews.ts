import { supabase } from '@/lib/supabase'
import { currentAvatarId } from '@/lib/avatars'
import { getOrCreateToken, addMyReviewId, removeMyReviewId } from '@/lib/reviewIdentity'

/**
 * 혼술바(매장) 사용자 후기 작성/수정/삭제/신고 — reviews(company_id)와 별개로 place_reviews 사용.
 * 이벤트 후기는 Edge Function(reviews) 이지만, 매장은 전용 RPC(SECURITY DEFINER)로 처리한다.
 */
type Ok<T> = { review: T } | { error: string }
const rpc = supabase.rpc.bind(supabase) as any

export async function submitPlaceReview(p: { placeId: string; nickname: string; rating: number; content: string }): Promise<Ok<any>> {
  const ownerToken = await getOrCreateToken()
  const { data, error } = await rpc('submit_place_review', {
    p_place_id: p.placeId, p_owner_token: ownerToken, p_nickname: p.nickname, p_rating: p.rating, p_content: p.content,
    p_avatar_id: currentAvatarId(),
  })
  if (error) return { error: error.message || '후기를 저장하지 못했습니다.' }
  const review = Array.isArray(data) ? data[0] : data
  if (review?.id) await addMyReviewId(review.id)
  return { review }
}

export async function updatePlaceReview(p: { reviewId: string; nickname?: string; rating?: number; content?: string }): Promise<Ok<any>> {
  const ownerToken = await getOrCreateToken()
  const { data, error } = await rpc('update_place_review', {
    p_id: p.reviewId, p_owner_token: ownerToken, p_nickname: p.nickname ?? null, p_rating: p.rating ?? null, p_content: p.content ?? null,
  })
  if (error) return { error: error.message || '후기를 수정하지 못했습니다.' }
  return { review: Array.isArray(data) ? data[0] : data }
}

export async function deletePlaceReview(reviewId: string): Promise<{ ok: true } | { error: string }> {
  const ownerToken = await getOrCreateToken()
  const { error } = await rpc('delete_place_review', { p_id: reviewId, p_owner_token: ownerToken })
  if (error) return { error: error.message || '삭제하지 못했습니다.' }
  await removeMyReviewId(reviewId)
  return { ok: true }
}

export async function reportPlaceReview(reviewId: string): Promise<{ ok: true } | { error: string }> {
  const { error } = await rpc('report_place_review', { p_id: reviewId })
  if (error) return { error: error.message || '신고하지 못했습니다.' }
  return { ok: true }
}

/** 내가 쓴 매장(혼술바) 후기 — MY '내가 쓴 후기'에 소개팅 후기와 함께 보여준다.
 *  reviews 화면(company 중심)과 섞으려고 ReviewRow 호환 형태로 만든다(매장명=companies.name). */
export async function fetchMyPlaceReviews(myReviewIds: string[]): Promise<any[]> {
  if (!myReviewIds.length) return []
  const sb = supabase as unknown as { from: (t: string) => any }
  const { data } = await sb.from('place_reviews')
    .select('id,place_id,content,rating,author_name,avatar_id,created_at,published_at,places(name)')
    .in('id', myReviewIds).eq('source', 'user').eq('is_active', true)
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id, content: r.content, rating: r.rating, author_name: r.author_name, avatar_id: r.avatar_id, gender: null,
    created_at: r.created_at, published_at: r.published_at, source: 'user', company_id: '',
    companies: { name: r.places?.name ?? '혼술바', slug: '' },
    _isPlace: true, _placeId: r.place_id,
  }))
}
