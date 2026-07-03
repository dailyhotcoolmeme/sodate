import { supabase, type ReviewRow } from '@/lib/supabase'
import {
  getOrCreateToken,
  addMyReviewId,
  removeMyReviewId,
} from '@/lib/reviewIdentity'

/**
 * reviews Edge Function 래퍼.
 * 서버가 검증/비속어필터/소유권확인을 담당하므로 여기서는 토큰 첨부 + 로컬 소유 id 기록만 한다.
 * 서버 에러 메시지는 그대로 노출한다({ error }).
 */

// 서버 submit/update 응답의 review 형태(전체 컬럼이 아닌 일부만 내려옴)
export type SubmittedReview = Pick<
  ReviewRow,
  'id' | 'company_id' | 'source' | 'author_name' | 'content' | 'rating' | 'published_at'
>

interface SubmitParams {
  companyId: string
  nickname: string
  rating: number
  content: string
}

interface UpdateParams {
  reviewId: string
  rating?: number
  content?: string
  nickname?: string
}

/** 서버 함수 응답에서 사용자 친화적 에러 메시지 추출 */
function extractError(error: any, data: any): string | null {
  // supabase-js는 non-2xx 시 error(FunctionsHttpError)를 반환. 서버 body의 error 문구를 우선 노출.
  if (data && typeof data.error === 'string') return data.error
  if (error) {
    // FunctionsHttpError.context.body 에 서버 JSON이 들어있을 수 있음
    const ctxBody = error?.context?.body
    if (ctxBody && typeof ctxBody === 'object' && typeof ctxBody.error === 'string') {
      return ctxBody.error
    }
    return error.message || '후기 처리 중 오류가 발생했습니다.'
  }
  return null
}

export async function submitReview(
  params: SubmitParams
): Promise<{ review: SubmittedReview } | { error: string }> {
  const ownerToken = await getOrCreateToken()
  const { data, error } = await supabase.functions.invoke('reviews', {
    body: {
      action: 'submit',
      companyId: params.companyId,
      nickname: params.nickname,
      rating: params.rating,
      content: params.content,
      ownerToken,
    },
  })
  const errMsg = extractError(error, data)
  if (errMsg) return { error: errMsg }
  const review = data?.review as SubmittedReview | undefined
  if (!review) return { error: '후기를 저장하지 못했습니다.' }
  await addMyReviewId(review.id)
  return { review }
}

export async function updateReview(
  params: UpdateParams
): Promise<{ review: SubmittedReview } | { error: string }> {
  const ownerToken = await getOrCreateToken()
  const body: Record<string, unknown> = {
    action: 'update',
    reviewId: params.reviewId,
    ownerToken,
  }
  if (params.rating !== undefined) body.rating = params.rating
  if (params.content !== undefined) body.content = params.content
  if (params.nickname !== undefined) body.nickname = params.nickname

  const { data, error } = await supabase.functions.invoke('reviews', { body })
  const errMsg = extractError(error, data)
  if (errMsg) return { error: errMsg }
  const review = data?.review as SubmittedReview | undefined
  if (!review) return { error: '후기를 수정하지 못했습니다.' }
  return { review }
}

export async function deleteReview(
  reviewId: string
): Promise<{ ok: true } | { error: string }> {
  const ownerToken = await getOrCreateToken()
  const { data, error } = await supabase.functions.invoke('reviews', {
    body: { action: 'delete', reviewId, ownerToken },
  })
  const errMsg = extractError(error, data)
  if (errMsg) return { error: errMsg }
  await removeMyReviewId(reviewId)
  return { ok: true }
}

export async function reportReview(
  reviewId: string,
  reason?: string
): Promise<{ ok: true; already?: boolean } | { error: string }> {
  // 신고자 식별도 동일 소유권 토큰 사용(reporterToken)
  const reporterToken = await getOrCreateToken()
  const { data, error } = await supabase.functions.invoke('reviews', {
    body: { action: 'report', reviewId, reporterToken, reason },
  })
  const errMsg = extractError(error, data)
  if (errMsg) return { error: errMsg }
  return { ok: true, already: data?.already === true }
}
