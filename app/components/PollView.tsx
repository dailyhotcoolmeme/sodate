import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { fetchPoll, votePoll, type Poll } from '@/lib/boardPoll'

/** 게시글 상세의 투표. 투표 전엔 선택 UI, 투표 후·마감이면 결과 막대. */
export default function PollView({ postId }: { postId: string }) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [poll, setPoll] = useState<Poll | null>(null)
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const p = await fetchPoll(postId)
    setPoll(p)
    setSel(p?.myVotes ?? [])
    setLoading(false)
  }
  useEffect(() => { load() }, [postId])

  if (loading) return <View style={styles.card}><ActivityIndicator color={colors.primary} /></View>
  if (!poll) return null

  const ended = !!poll.endsAt && new Date(poll.endsAt) < new Date()
  const voted = poll.myVotes.length > 0
  const showResult = voted || ended
  const total = poll.options.reduce((a, o) => a + o.count, 0)

  const toggle = (id: string) => {
    if (poll.allowMulti) setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
    else setSel([id])
  }
  const submit = async () => {
    if (!sel.length || busy) return
    setBusy(true)
    const r = await votePoll(poll.id, sel)
    setBusy(false)
    if ('error' in r) return
    await load()
  }

  return (
    <View style={styles.card}>
      {!!poll.question && <Text style={styles.q}>{poll.question}</Text>}

      {poll.options.map((o) => {
        const pct = total > 0 ? Math.round((o.count / total) * 100) : 0
        const mine = poll.myVotes.includes(o.id)
        const picked = sel.includes(o.id)
        if (showResult) {
          return (
            <View key={o.id} style={styles.resultRow}>
              <View style={[styles.bar, { width: `${pct}%`, backgroundColor: mine ? colors.primary + '33' : colors.surfaceHigh }]} />
              <View style={styles.resultInner}>
                <Text style={[styles.optLabel, mine && styles.optLabelMine]} numberOfLines={2}>
                  {mine ? '✓ ' : ''}{o.label}
                </Text>
                <Text style={[styles.pct, mine && styles.optLabelMine]}>{pct}%</Text>
              </View>
            </View>
          )
        }
        return (
          <TouchableOpacity key={o.id} style={[styles.optBtn, picked && styles.optBtnOn]} onPress={() => toggle(o.id)} activeOpacity={0.8}>
            <Ionicons
              name={poll.allowMulti ? (picked ? 'checkbox' : 'square-outline') : (picked ? 'radio-button-on' : 'radio-button-off')}
              size={20} color={picked ? colors.primary : colors.textTertiary}
            />
            <Text style={[styles.optLabel, picked && styles.optLabelMine]} numberOfLines={2}>{o.label}</Text>
          </TouchableOpacity>
        )
      })}

      <View style={styles.footer}>
        <Text style={styles.meta}>
          {poll.totalVoters}명 참여{poll.allowMulti ? ' · 복수선택' : ''}
          {poll.endsAt ? ` · ${ended ? '마감됨' : deadlineLabel(poll.endsAt)}` : ''}
        </Text>
        {!showResult && (
          <TouchableOpacity style={[styles.voteBtn, !sel.length && styles.voteBtnOff]} onPress={submit} disabled={!sel.length || busy}>
            <Text style={[styles.voteBtnText, !sel.length && styles.voteBtnTextOff]}>{busy ? '…' : '투표하기'}</Text>
          </TouchableOpacity>
        )}
        {showResult && !ended && (
          <TouchableOpacity onPress={() => { setSel(poll.myVotes); setPoll({ ...poll, myVotes: [] }) }}>
            <Text style={styles.recast}>다시 투표</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

function deadlineLabel(endsAt: string): string {
  const ms = new Date(endsAt).getTime() - Date.now()
  if (ms <= 0) return '마감됨'
  const h = Math.floor(ms / 3600000)
  if (h >= 24) return `${Math.floor(h / 24)}일 남음`
  if (h >= 1) return `${h}시간 남음`
  return `${Math.max(1, Math.floor(ms / 60000))}분 남음`
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    card: { marginTop: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, backgroundColor: colors.surface, gap: 8 },
    q: { fontSize: 15, fontWeight: '800', color: colors.textPrimary, marginBottom: 2 },
    optBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    optBtnOn: { borderColor: colors.primary, backgroundColor: colors.primary + '10' },
    optLabel: { flex: 1, fontSize: 14.5, color: colors.textPrimary },
    optLabelMine: { color: colors.primary, fontWeight: '700' },
    resultRow: { height: 44, borderRadius: 10, backgroundColor: colors.surfaceHigh, overflow: 'hidden', justifyContent: 'center' },
    bar: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 10 },
    resultInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, gap: 8 },
    pct: { fontSize: 13.5, fontWeight: '800', color: colors.textSecondary },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
    meta: { flex: 1, fontSize: 12, color: colors.textTertiary },
    voteBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
    voteBtnOff: { backgroundColor: colors.surfaceHigh },
    voteBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
    voteBtnTextOff: { color: colors.textTertiary },
    recast: { fontSize: 13, color: colors.primary, fontWeight: '700' },
  })
}
