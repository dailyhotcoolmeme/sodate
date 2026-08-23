import { supabase } from '@/lib/supabase'
import { getOrCreateToken } from '@/lib/reviewIdentity'

/** 게시판 투표(poll). board Edge Function 을 타서 owner_token 해시를 서버가 일관 처리한다. */
export interface PollOption { id: string; label: string; count: number }
export interface Poll {
  id: string
  question: string | null
  allowMulti: boolean
  endsAt: string | null
  options: PollOption[]
  totalVoters: number
  myVotes: string[]
}

async function call(body: Record<string, unknown>): Promise<any> {
  const ownerToken = await getOrCreateToken()
  const { data, error } = await supabase.functions.invoke('board', { body: { ...body, ownerToken } })
  if (error) {
    // Edge Function 이 4xx로 { error } 를 돌려줄 때 메시지 추출
    try { const j = await (error as any).context?.json?.(); if (j?.error) return { error: j.error } } catch { /* noop */ }
    return { error: '잠시 후 다시 시도해주세요.' }
  }
  return data
}

/** 글 작성 후 투표 붙이기. options 2~5개. endsAt=null 이면 무기한. */
export async function createPoll(p: {
  postId: string
  question: string
  options: string[]
  allowMulti: boolean
  endsAt: string | null
}): Promise<{ pollId: string } | { error: string }> {
  const r = await call({ action: 'createPoll', ...p })
  return 'error' in r ? r : { pollId: r.pollId }
}

export async function fetchPoll(postId: string): Promise<Poll | null> {
  const r = await call({ action: 'getPoll', postId })
  if (!r || 'error' in r) return null
  return r.poll ?? null
}

export async function votePoll(pollId: string, optionIds: string[]): Promise<{ ok: true } | { error: string }> {
  const r = await call({ action: 'votePoll', pollId, optionIds })
  return 'error' in r ? r : { ok: true }
}
