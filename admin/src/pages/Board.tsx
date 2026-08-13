import { useEffect, useState, Fragment } from 'react'
import { supabase } from '../lib/supabase'
import { Flag, EyeOff, Eye, Trash2, ImageOff, ShieldBan, Plus, Lock, UserSearch, X, Youtube } from 'lucide-react'

/**
 * 게시판 관리 — 신고 대응이 핵심이다.
 * 애플 1.2는 익명 게시판에 신고·차단 수단과 24시간 내 처리를 요구한다.
 * 여기가 없으면 신고가 들어와도 손댈 곳이 없어 그것만으로 반려 사유가 된다.
 */

interface Post {
  id: string
  nickname: string
  title: string
  content: string
  image_urls: string[] | null
  link_urls: string[] | null
  tag_id: string | null
  upvotes: number
  downvotes: number
  comment_count: number
  report_count: number
  content_report_count: number
  is_active: boolean
  content_hidden: boolean
  created_at: string
}

interface BoardTag {
  id: string
  label: string
  sort_order: number
  is_active: boolean
  created_at: string
}

interface Comment {
  id: string
  post_id: string
  parent_id: string | null
  nickname: string
  /** 비밀 댓글이면 빈 문자열 — 본문은 secret_content 에 따로 있다 */
  content: string
  is_secret: boolean
  report_count: number
  is_active: boolean
  created_at: string
}

/** 목록·모달 공용 카드에서 owner_token 이 필요할 때만 쓰는 최소 타입(화면엔 안 보여줌) */
type WithToken = { owner_token: string }

interface Report {
  id: string
  target_type: string
  target_id: string
  reason: string | null
  created_at: string
}

type Tab = 'reported' | 'all' | 'hidden' | 'comments' | 'tags'

export default function Board() {
  const [tab, setTab] = useState<Tab>('reported')  // 신고된 것부터 본다
  const [posts, setPosts] = useState<Post[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [tags, setTags] = useState<BoardTag[]>([])
  const [newTagLabel, setNewTagLabel] = useState('')
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [msg, setMsg] = useState('')
  /** 신고된 비밀 댓글 중 관리자가 열어본 것의 본문 (id → 내용) */
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  /** 사용자(기기)별 활동 보기 — 위험한 사용자인지 전체 이력을 보고 판단하려면
   *  글 하나·댓글 하나만으로는 안 된다(2026-08-13 오너 지시). */
  const [userActivity, setUserActivity] = useState<{ token: string; posts: Post[]; comments: Comment[] } | null>(null)
  const [userActivityLoading, setUserActivityLoading] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [p, c, t] = await Promise.all([
      supabase.from('board_posts').select('*').order('created_at', { ascending: false }).limit(500),
      // ⚠️ select('*') 를 쓰면 안 된다 — admin은 service_role 로 프록시되므로 비밀 댓글
      //    본문(secret_content)까지 전부 관리자 브라우저로 내려온다. 비밀 댓글은 신고된
      //    건만, 그것도 눌렀을 때만 따로 가져온다(아래 revealSecret, 2026-08-12 오너 확정).
      supabase.from('board_comments')
        .select('id,post_id,parent_id,nickname,content,is_secret,report_count,is_active,created_at')
        .order('created_at', { ascending: false }).limit(500),
      supabase.from('board_tags').select('*').order('sort_order', { ascending: true }),
    ])
    setPosts((p.data as Post[]) ?? [])
    setComments((c.data as Comment[]) ?? [])
    setTags((t.data as BoardTag[]) ?? [])
    setLoading(false)
  }

  /**
   * 신고된 비밀 댓글의 본문 열람. 신고가 들어온 건만 볼 수 있다 — 신고도 없는데 사적인
   * 연락처 대화를 관리자가 들여다볼 이유가 없다(2026-08-12 오너 확정).
   * 목록에 미리 담아두지 않고 누를 때 한 건씩 가져온다.
   */
  async function revealSecret(c: Comment) {
    if (!c.is_secret || c.report_count < 1) return
    if (revealed[c.id] !== undefined) { // 다시 누르면 접는다
      setRevealed((prev) => { const next = { ...prev }; delete next[c.id]; return next })
      return
    }
    const { data, error } = await supabase.from('board_comments')
      .select('secret_content').eq('id', c.id).maybeSingle()
    if (error) { alert(`실패: ${error.message}`); return }
    setRevealed((prev) => ({ ...prev, [c.id]: (data as any)?.secret_content ?? '(내용 없음)' }))
  }

  /** 말머리 등록 — admin이 넣은 문자열 그대로 저장한다([말머리1] 처럼 대괄호까지 직접 입력). */
  async function addTag() {
    const label = newTagLabel.trim()
    if (!label) return
    const nextOrder = tags.length ? Math.max(...tags.map((t) => t.sort_order)) + 1 : 0
    const { data, error } = await supabase.from('board_tags')
      .insert({ label, sort_order: nextOrder }).select('*').single()
    if (error) { alert(`실패: ${error.message}`); return }
    setTags((prev) => [...prev, data as BoardTag])
    setNewTagLabel('')
  }

  async function toggleTagActive(t: BoardTag) {
    const { error } = await supabase.from('board_tags')
      .update({ is_active: !t.is_active }).eq('id', t.id)
    if (error) { alert(`실패: ${error.message}`); return }
    setTags((prev) => prev.map((x) => x.id === t.id ? { ...x, is_active: !x.is_active } : x))
  }

  async function renameTag(t: BoardTag, label: string) {
    if (!label.trim() || label === t.label) return
    const { error } = await supabase.from('board_tags').update({ label }).eq('id', t.id)
    if (error) { alert(`실패: ${error.message}`); return }
    setTags((prev) => prev.map((x) => x.id === t.id ? { ...x, label } : x))
  }

  async function removeTag(t: BoardTag) {
    const inUse = posts.some((p) => p.tag_id === t.id)
    const warn = inUse
      ? `'${t.label}' 말머리를 완전히 삭제할까요? 이미 이 말머리가 붙은 글에서도 말머리가 사라집니다.\n(글만 없애고 싶다면 취소 후 '비활성화'를 쓰세요.)`
      : `'${t.label}' 말머리를 삭제할까요?`
    if (!window.confirm(warn)) return
    const { error } = await supabase.from('board_tags').delete().eq('id', t.id)
    if (error) { alert(`실패: ${error.message}`); return }
    setTags((prev) => prev.filter((x) => x.id !== t.id))
  }

  async function openReports(targetId: string) {
    if (expanded === targetId) { setExpanded(null); return }
    setExpanded(targetId)
    const { data } = await supabase.from('board_reports').select('*')
      .eq('target_id', targetId).order('created_at', { ascending: false })
    setReports((data as Report[]) ?? [])
  }

  async function togglePost(p: Post) {
    const confirmMsg = p.is_active ? `'${p.title}' 글을 숨길까요?` : `'${p.title}' 글을 다시 노출할까요?`
    if (!window.confirm(confirmMsg)) return
    const { error } = await supabase.from('board_posts')
      .update({ is_active: !p.is_active }).eq('id', p.id)
    if (error) { alert(`실패: ${error.message}`); return }
    setPosts((prev) => prev.map((x) => x.id === p.id ? { ...x, is_active: !x.is_active } : x))
    setMsg(p.is_active ? '글을 숨겼습니다' : '글을 다시 노출했습니다')
  }

  /** 사진·유튜브 링크 등 첨부 전체를 한 번에 가림/복구(2026-08-13 일반화 — 이미지 전용이던 걸 확장) */
  async function toggleContent(p: Post) {
    const confirmMsg = p.content_hidden ? '첨부(사진·링크)를 다시 노출할까요?' : '첨부(사진·링크)를 가릴까요?'
    if (!window.confirm(confirmMsg)) return
    const { error } = await supabase.from('board_posts')
      .update({ content_hidden: !p.content_hidden }).eq('id', p.id)
    if (error) { alert(`실패: ${error.message}`); return }
    setPosts((prev) => prev.map((x) => x.id === p.id ? { ...x, content_hidden: !x.content_hidden } : x))
    setMsg(p.content_hidden ? '첨부를 다시 노출했습니다' : '첨부를 가렸습니다')
  }

  async function removePost(p: Post) {
    if (!window.confirm(`'${p.title}' 글을 삭제할까요? 댓글도 함께 사라집니다.`)) return
    const { error } = await supabase.from('board_posts').delete().eq('id', p.id)
    if (error) { alert(`실패: ${error.message}`); return }
    setPosts((prev) => prev.filter((x) => x.id !== p.id))
    setMsg('삭제했습니다')
  }

  async function toggleComment(c: Comment) {
    const confirmMsg = c.is_active ? '이 댓글을 숨길까요?' : '이 댓글을 다시 노출할까요?'
    if (!window.confirm(confirmMsg)) return
    const { error } = await supabase.from('board_comments')
      .update({ is_active: !c.is_active }).eq('id', c.id)
    if (error) { alert(`실패: ${error.message}`); return }
    setComments((prev) => prev.map((x) => x.id === c.id ? { ...x, is_active: !x.is_active } : x))
  }

  async function removeComment(c: Comment) {
    if (!window.confirm('이 댓글을 삭제할까요?')) return
    const { error } = await supabase.from('board_comments').delete().eq('id', c.id)
    if (error) { alert(`실패: ${error.message}`); return }
    setComments((prev) => prev.filter((x) => x.id !== c.id))
  }

  /** 기기 차단 — 애플 1.2 필수 요건. owner_token 은 화면에 보여주지 않고 값만 넘긴다.
   *  ⚠️(2026-08-13 오너 지시) 글·댓글 행에는 차단 버튼을 안 둔다 — 글 하나만 보고
   *  차단하면 성급한 판단이 될 수 있어서, 아래 활동 보기 모달에서 이 사용자가 쓴
   *  전체 이력을 다 본 뒤에만 차단할 수 있게 여기로 좁혔다.
   *  차단은 "쓰기"만 막는다(board Edge Function이 action 처리 전에 board_blocks를
   *  먼저 검사 — supabase/functions/board/index.ts). 글 목록·상세 읽기는 RLS가
   *  is_active만 보므로 board_blocks와 무관하게 그대로 된다. 즉 차단된 사용자도
   *  커뮤니티는 계속 볼 수 있고 글·댓글·추천만 못 쓴다(오너 확인 2026-08-13, 의도된 동작). */
  async function blockToken(token: string) {
    if (!window.confirm('이 작성자의 기기를 차단할까요? 커뮤니티 열람은 계속 되고, 글·댓글·추천만 못 쓰게 됩니다.')) return
    const { error } = await supabase.from('board_blocks')
      .upsert({ owner_token: token, reason: '관리자 차단' }, { onConflict: 'owner_token' })
    if (error) { alert(`실패: ${error.message}`); return }
    setMsg('차단했습니다')
  }

  /**
   * 이 사용자(기기)가 쓴 다른 글·댓글을 전부 모아 보여준다 — 위험한 사용자인지는
   * 글·댓글 하나만 보고는 판단이 안 되므로(2026-08-13 오너 지시), 신고 이력·전체
   * 작성 패턴을 한 번에 보고 차단 여부를 정할 수 있게 한다.
   */
  async function viewUserActivity(kind: 'post' | 'comment', id: string) {
    const table = kind === 'post' ? 'board_posts' : 'board_comments'
    const { data } = await supabase.from(table).select('owner_token').eq('id', id).maybeSingle()
    const token = (data as WithToken | null)?.owner_token
    if (!token) { alert('작성자를 찾을 수 없습니다'); return }
    setUserActivityLoading(true)
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from('board_posts').select('*').eq('owner_token', token).order('created_at', { ascending: false }),
      supabase.from('board_comments')
        .select('id,post_id,parent_id,nickname,content,is_secret,report_count,is_active,created_at')
        .eq('owner_token', token).order('created_at', { ascending: false }),
    ])
    setUserActivity({ token, posts: (p as Post[]) ?? [], comments: (c as Comment[]) ?? [] })
    setUserActivityLoading(false)
  }

  const shownPosts = posts.filter((p) => {
    if (tab === 'reported') return p.report_count > 0 || p.content_report_count > 0
    if (tab === 'hidden') return !p.is_active || p.content_hidden
    return true
  })
  const shownComments = tab === 'comments' ? comments : []

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'reported', label: '신고됨', count: posts.filter((p) => p.report_count > 0 || p.content_report_count > 0).length },
    { key: 'all', label: '전체 글', count: posts.length },
    { key: 'hidden', label: '숨김·가림', count: posts.filter((p) => !p.is_active || p.content_hidden).length },
    { key: 'comments', label: '댓글', count: comments.length },
    { key: 'tags', label: '말머리', count: tags.length },
  ]

  const tagLabel = (id: string | null) => id ? tags.find((t) => t.id === id)?.label ?? null : null

  return (
    // 바깥 여백은 다른 관리 페이지와 같은 값을 쓴다(p-4 md:p-8) — 여기만 빠져 있어서
    // 본문 시작 위치가 혼자 달랐다(2026-08-12 오너 지적).
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h1 className="text-xl font-bold">게시판 관리</h1>
        {msg && <span className="text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5 text-sm">{msg}</span>}
      </div>

      <div className="flex items-center gap-2 mb-4 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-bold -mb-px border-b-2 ${
              tab === t.key ? 'border-pink-500 text-pink-600' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {t.label} <span className="ml-0.5">{t.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      ) : tab === 'tags' ? (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4 max-w-xl">
          <div className="flex items-center gap-2">
            <input
              value={newTagLabel}
              onChange={(e) => setNewTagLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTag() }}
              placeholder="예: [말머리1]"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={addTag}
              disabled={!newTagLabel.trim()}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-pink-500 text-white text-sm font-medium disabled:opacity-40"
            >
              <Plus size={14} /> 등록
            </button>
          </div>
          <p className="text-xs text-gray-400">
            등록한 문자열이 그대로 목록·글쓰기에 보입니다. 대괄호 등 표시 형식도 여기서 직접 입력하세요.
          </p>
          <div className="divide-y divide-gray-100">
            {tags.map((t) => (
              <div key={t.id} className="flex items-center gap-2 py-2.5">
                <input
                  defaultValue={t.label}
                  onBlur={(e) => renameTag(t, e.target.value)}
                  className={`flex-1 border border-transparent hover:border-gray-200 focus:border-pink-300 rounded-lg px-2 py-1.5 text-sm ${t.is_active ? 'text-gray-800' : 'text-gray-400'}`}
                />
                <button
                  onClick={() => toggleTagActive(t)}
                  className={`px-2 py-1 rounded-lg border text-xs font-medium ${
                    t.is_active
                      ? 'border-green-200 text-green-600 hover:bg-green-50'
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {t.is_active ? '사용 중' : '비활성'}
                </button>
                <button
                  onClick={() => removeTag(t)}
                  className="p-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                  title="삭제"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {tags.length === 0 && (
              <p className="py-6 text-center text-gray-400 text-sm">등록된 말머리가 없습니다.</p>
            )}
          </div>
        </div>
      ) : tab === 'comments' ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[860px] table-fixed text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-3 text-left font-medium w-[120px]">닉네임</th>
                <th className="px-3 py-3 text-left font-medium">내용</th>
                <th className="px-3 py-3 text-center font-medium w-[80px]">신고수</th>
                <th className="px-3 py-3 text-center font-medium w-[86px]">노출</th>
                <th className="px-3 py-3 text-left font-medium w-[110px]">작성일</th>
                <th className="px-3 py-3 text-center font-medium w-[200px]">액션</th>
              </tr>
            </thead>
            <tbody>
              {shownComments.map((c) => (
                <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50 [&>td]:whitespace-nowrap">
                  <td className="px-3 py-3 text-gray-700 text-xs truncate">{c.nickname}</td>
                  <td className="px-3 py-3">
                    <p className="text-gray-800 text-xs truncate" title={revealed[c.id] ?? c.content}>
                      {c.parent_id ? '↳ ' : ''}
                      {/* 비밀 댓글은 본문이 목록에 안 담긴다(글쓴이·당사자만 앱에서 볼 수 있음).
                          신고가 들어온 건만 눌러서 내용을 확인할 수 있다. */}
                      {c.is_secret && (
                        <span className="inline-flex items-center gap-0.5 mr-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">
                          <Lock size={10} /> 비밀댓글
                        </span>
                      )}
                      {c.is_secret && c.report_count > 0 && (
                        <button
                          onClick={() => revealSecret(c)}
                          className="mr-1 underline text-gray-500 hover:text-gray-800"
                        >
                          {revealed[c.id] !== undefined ? '내용 접기' : '내용 보기'}
                        </button>
                      )}
                      {revealed[c.id] ?? c.content}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-center">
                    {c.report_count > 0
                      ? <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-xs font-semibold"><Flag size={11} /> {c.report_count}</span>
                      : <span className="text-gray-300 text-xs">0</span>}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {c.is_active
                      ? <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-600 text-xs font-medium">노출 중</span>
                      : <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">숨김</span>}
                  </td>
                  <td className="px-3 py-3 text-gray-400 text-xs">{new Date(c.created_at).toLocaleDateString('ko-KR')}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => toggleComment(c)} className="px-2 py-1 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50">
                        {c.is_active ? '숨김' : '노출'}
                      </button>
                      <button onClick={() => viewUserActivity('comment', c.id)} className="px-2 py-1 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50">
                        활동 보기
                      </button>
                      <button onClick={() => removeComment(c)} className="px-2 py-1 rounded-lg border border-red-200 text-xs font-medium text-red-600 hover:bg-red-50">
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {shownComments.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">댓글이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[960px] table-fixed text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-3 text-left font-medium w-[120px]">닉네임</th>
                <th className="px-3 py-3 text-left font-medium">제목</th>
                <th className="px-3 py-3 text-center font-medium w-[96px]">추천/비추</th>
                <th className="px-3 py-3 text-center font-medium w-[70px]">댓글</th>
                <th className="px-3 py-3 text-center font-medium w-[110px]">신고(글/사진)</th>
                <th className="px-3 py-3 text-center font-medium w-[86px]">노출</th>
                <th className="px-3 py-3 text-center font-medium w-[240px]">액션</th>
              </tr>
            </thead>
            <tbody>
              {shownPosts.map((p) => (
                <Fragment key={p.id}>
                  <tr className="border-t border-gray-100 hover:bg-gray-50 [&>td]:whitespace-nowrap">
                    <td className="px-3 py-3 text-gray-700 text-xs truncate">{p.nickname}</td>
                    <td className="px-3 py-3">
                      <button onClick={() => openReports(p.id)} className="block w-full text-left">
                        <p className="text-gray-800 text-xs truncate" title={p.content}>
                          {tagLabel(p.tag_id) && <span className="text-pink-500 font-semibold">{tagLabel(p.tag_id)} </span>}
                          {p.title}
                          {!!p.image_urls?.length && <span className="ml-1 text-gray-400">[사진 {p.image_urls.length}]</span>}
                          {!!p.link_urls?.length && <span className="ml-1 text-gray-400">[링크 {p.link_urls.length}]</span>}
                        </p>
                      </button>
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-gray-600">{p.upvotes} / {p.downvotes}</td>
                    <td className="px-3 py-3 text-center text-xs text-gray-600">{p.comment_count}</td>
                    <td className="px-3 py-3 text-center">
                      {p.report_count > 0 || p.content_report_count > 0 ? (
                        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-xs font-semibold">
                          <Flag size={11} /> {p.report_count} / {p.content_report_count}
                        </span>
                      ) : <span className="text-gray-300 text-xs">0 / 0</span>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {p.is_active
                        ? <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-600 text-xs font-medium">노출 중</span>
                        : <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">숨김</span>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => togglePost(p)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50">
                          {p.is_active ? <><EyeOff size={12} /> 숨김</> : <><Eye size={12} /> 노출</>}
                        </button>
                        {(!!p.image_urls?.length || !!p.link_urls?.length) && (
                          <button onClick={() => toggleContent(p)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50">
                            <ImageOff size={12} /> {p.content_hidden ? '첨부 복구' : '첨부 가림'}
                          </button>
                        )}
                        <button onClick={() => viewUserActivity('post', p.id)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50">
                          <UserSearch size={12} /> 활동 보기
                        </button>
                        <button onClick={() => removePost(p)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-red-200 text-xs font-medium text-red-600 hover:bg-red-50">
                          <Trash2 size={12} /> 삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === p.id && (
                    <tr className="border-t border-gray-100 bg-gray-50/60">
                      <td colSpan={7} className="px-4 py-3 space-y-2">
                        <p className="text-xs text-gray-700 whitespace-pre-wrap">{p.content}</p>
                        {reports.length > 0 && (
                          <div className="space-y-1.5 pt-2 border-t border-gray-200">
                            <p className="text-xs font-medium text-gray-500">신고 사유 ({reports.length}건)</p>
                            {reports.map((r) => (
                              <div key={r.id} className="flex items-start gap-2 text-xs text-gray-700">
                                <Flag size={12} className="text-red-400 mt-0.5 shrink-0" />
                                <span className="shrink-0 text-gray-400">
                                  {r.target_type === 'content' ? '첨부' : r.target_type === 'comment' ? '댓글' : '글'}
                                </span>
                                <span className="flex-1">{r.reason || '(사유 없음)'}</span>
                                <span className="text-gray-400 whitespace-nowrap">
                                  {new Date(r.created_at).toLocaleDateString('ko-KR')}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {shownPosts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">
                    {tab === 'reported' ? '신고된 글이 없습니다.' : '글이 없습니다.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {(userActivity || userActivityLoading) && (
        <UserActivityModal
          activity={userActivity}
          loading={userActivityLoading}
          tagLabel={tagLabel}
          onClose={() => setUserActivity(null)}
          onBlock={() => userActivity && blockToken(userActivity.token)}
          onTogglePost={togglePost}
          onRemovePost={removePost}
          onToggleComment={toggleComment}
          onRemoveComment={removeComment}
        />
      )}
    </div>
  )
}

/**
 * 사용자(기기)별 활동 모음 — 위험한 사용자인지 글·댓글 하나만 보고는 판단이 안 돼서
 * (2026-08-13 오너 지시) 신고 이력을 포함한 전체 작성 이력을 한 화면에서 보고,
 * 그 자리에서 바로 숨김·삭제·차단까지 할 수 있게 한다. owner_token 원문은
 * 화면에 안 띄운다(기존 blockAuthor 규칙과 동일).
 */
function UserActivityModal({
  activity, loading, tagLabel, onClose, onBlock, onTogglePost, onRemovePost, onToggleComment, onRemoveComment,
}: {
  activity: { token: string; posts: Post[]; comments: Comment[] } | null
  loading: boolean
  tagLabel: (id: string | null) => string | null
  onClose: () => void
  onBlock: () => void
  onTogglePost: (p: Post) => void
  onRemovePost: (p: Post) => void
  onToggleComment: (c: Comment) => void
  onRemoveComment: (c: Comment) => void
}) {
  const reportedPosts = activity?.posts.filter((p) => p.report_count > 0 || p.content_report_count > 0).length ?? 0
  const reportedComments = activity?.comments.filter((c) => c.report_count > 0).length ?? 0

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-base font-bold text-gray-900">이 사용자의 활동</h2>
            {activity && (
              <p className="text-xs text-gray-400 mt-0.5">
                글 {activity.posts.length}개(신고 {reportedPosts}) · 댓글 {activity.comments.length}개(신고 {reportedComments})
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activity && (
              <button
                onClick={onBlock}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-orange-200 text-xs font-medium text-orange-600 hover:bg-orange-50"
              >
                <ShieldBan size={13} /> 이 사용자 차단
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading ? (
            <p className="text-gray-400 text-sm py-8 text-center">불러오는 중...</p>
          ) : (
            <>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">작성한 글</p>
                <div className="space-y-1.5">
                  {(activity?.posts ?? []).map((p) => (
                    <div key={p.id} className="border border-gray-100 rounded-lg px-3 py-2 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-800 truncate">
                            {tagLabel(p.tag_id) && <span className="text-pink-500 font-semibold">{tagLabel(p.tag_id)} </span>}
                            {p.title}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {new Date(p.created_at).toLocaleDateString('ko-KR')}
                            {(p.report_count > 0 || p.content_report_count > 0) && (
                              <span className="ml-1.5 text-red-500 font-medium">신고 {p.report_count}/{p.content_report_count}</span>
                            )}
                            {!p.is_active && <span className="ml-1.5 text-gray-400">(숨김)</span>}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => onTogglePost(p)} className="px-2 py-1 rounded-lg border border-gray-200 text-[11px] font-medium text-gray-600 hover:bg-gray-50">
                            {p.is_active ? '숨김' : '노출'}
                          </button>
                          <button onClick={() => onRemovePost(p)} className="px-2 py-1 rounded-lg border border-red-200 text-[11px] font-medium text-red-600 hover:bg-red-50">
                            삭제
                          </button>
                        </div>
                      </div>
                      {/* 사진은 썸네일, 유튜브는 링크로 — 신고 대응할 때 첨부를 눌러서 바로
                          확인할 수 있어야 한다(2026-08-13 오너 지시). */}
                      {(!!p.image_urls?.length || !!p.link_urls?.length) && (
                        <div className="flex flex-wrap gap-1.5">
                          {p.image_urls?.map((u) => (
                            <a
                              key={u} href={u} target="_blank" rel="noreferrer"
                              className="block w-12 h-12 rounded-md overflow-hidden border border-gray-200 shrink-0"
                              title="눌러서 전체 보기"
                            >
                              <img src={u} alt="" className="w-full h-full object-cover" />
                            </a>
                          ))}
                          {p.link_urls?.map((u) => (
                            <a
                              key={u} href={u} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 max-w-[160px] px-2 py-1 rounded-md border border-gray-200 text-[11px] text-red-500 hover:bg-red-50 truncate"
                              title={u}
                            >
                              <Youtube size={12} className="shrink-0" /> <span className="truncate">{u}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {(activity?.posts.length ?? 0) === 0 && (
                    <p className="text-center text-gray-300 text-xs py-4">작성한 글이 없습니다.</p>
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">작성한 댓글</p>
                <div className="space-y-1.5">
                  {(activity?.comments ?? []).map((c) => (
                    <div key={c.id} className="flex items-center gap-2 border border-gray-100 rounded-lg px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-800 truncate">
                          {c.parent_id ? '↳ ' : ''}
                          {c.is_secret ? <span className="text-amber-700">(비밀댓글)</span> : c.content}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {new Date(c.created_at).toLocaleDateString('ko-KR')}
                          {c.report_count > 0 && <span className="ml-1.5 text-red-500 font-medium">신고 {c.report_count}</span>}
                          {!c.is_active && <span className="ml-1.5 text-gray-400">(숨김)</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => onToggleComment(c)} className="px-2 py-1 rounded-lg border border-gray-200 text-[11px] font-medium text-gray-600 hover:bg-gray-50">
                          {c.is_active ? '숨김' : '노출'}
                        </button>
                        <button onClick={() => onRemoveComment(c)} className="px-2 py-1 rounded-lg border border-red-200 text-[11px] font-medium text-red-600 hover:bg-red-50">
                          삭제
                        </button>
                      </div>
                    </div>
                  ))}
                  {(activity?.comments.length ?? 0) === 0 && (
                    <p className="text-center text-gray-300 text-xs py-4">작성한 댓글이 없습니다.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
