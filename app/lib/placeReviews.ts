import { supabase } from '@/lib/supabase'
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
