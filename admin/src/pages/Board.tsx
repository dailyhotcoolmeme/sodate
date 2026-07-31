import { useEffect, useState, Fragment } from 'react'
import { supabase } from '../lib/supabase'
import { Flag, EyeOff, Eye, Trash2, ImageOff, ShieldBan } from 'lucide-react'

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
  upvotes: number
  downvotes: number
  comment_count: number
  report_count: number
  image_report_count: number
  is_active: boolean
  image_hidden: boolean
  created_at: string
}

interface Comment {
  id: string
  post_id: string
  parent_id: string | null
  nickname: string
  content: string
  report_count: number
  is_active: boolean
  created_at: string
}

interface Report {
  id: string
  target_type: string
  target_id: string
  reason: string | null
  created_at: string
}

type Tab = 'reported' | 'all' | 'hidden' | 'comments'

export default function Board() {
  const [tab, setTab] = useState<Tab>('reported')  // 신고된 것부터 본다
  const [posts, setPosts] = useState<Post[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [msg, setMsg] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [p, c] = await Promise.all([
      supabase.from('board_posts').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('board_comments').select('*').order('created_at', { ascending: false }).limit(500),
    ])
    setPosts((p.data as Post[]) ?? [])
    setComments((c.data as Comment[]) ?? [])
    setLoading(false)
  }

  async function openReports(targetId: string) {
    if (expanded === targetId) { setExpanded(null); return }
    setExpanded(targetId)
    const { data } = await supabase.from('board_reports').select('*')
      .eq('target_id', targetId).order('created_at', { ascending: false })
    setReports((data as Report[]) ?? [])
  }

  async function togglePost(p: Post) {
    const { error } = await supabase.from('board_posts')
      .update({ is_active: !p.is_active }).eq('id', p.id)
    if (error) { alert(`실패: ${error.message}`); return }
    setPosts((prev) => prev.map((x) => x.id === p.id ? { ...x, is_active: !x.is_active } : x))
    setMsg(p.is_active ? '글을 숨겼습니다' : '글을 다시 노출했습니다')
  }

  async function toggleImage(p: Post) {
    const { error } = await supabase.from('board_posts')
      .update({ image_hidden: !p.image_hidden }).eq('id', p.id)
    if (error) { alert(`실패: ${error.message}`); return }
    setPosts((prev) => prev.map((x) => x.id === p.id ? { ...x, image_hidden: !x.image_hidden } : x))
    setMsg(p.image_hidden ? '이미지를 다시 노출했습니다' : '이미지를 가렸습니다')
  }

  async function removePost(p: Post) {
    if (!window.confirm(`'${p.title}' 글을 삭제할까요? 댓글도 함께 사라집니다.`)) return
    const { error } = await supabase.from('board_posts').delete().eq('id', p.id)
    if (error) { alert(`실패: ${error.message}`); return }
    setPosts((prev) => prev.filter((x) => x.id !== p.id))
    setMsg('삭제했습니다')
  }

  async function toggleComment(c: Comment) {
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

  /** 기기 차단 — 애플 1.2 필수 요건. owner_token 은 화면에 보여주지 않고 값만 넘긴다. */
  async function blockAuthor(kind: 'post' | 'comment', id: string) {
    if (!window.confirm('이 작성자의 기기를 차단할까요? 이후 글·댓글을 쓸 수 없게 됩니다.')) return
    const table = kind === 'post' ? 'board_posts' : 'board_comments'
    const { data } = await supabase.from(table).select('owner_token').eq('id', id).maybeSingle()
    const token = (data as any)?.owner_token
    if (!token) { alert('작성자를 찾을 수 없습니다'); return }
    const { error } = await supabase.from('board_blocks')
      .upsert({ owner_token: token, reason: '관리자 차단' }, { onConflict: 'owner_token' })
    if (error) { alert(`실패: ${error.message}`); return }
    setMsg('차단했습니다')
  }

  const shownPosts = posts.filter((p) => {
    if (tab === 'reported') return p.report_count > 0 || p.image_report_count > 0
    if (tab === 'hidden') return !p.is_active || p.image_hidden
    return true
  })
  const shownComments = tab === 'comments' ? comments : []

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'reported', label: '신고됨', count: posts.filter((p) => p.report_count > 0 || p.image_report_count > 0).length },
    { key: 'all', label: '전체 글', count: posts.length },
    { key: 'hidden', label: '숨김·가림', count: posts.filter((p) => !p.is_active || p.image_hidden).length },
    { key: 'comments', label: '댓글', count: comments.length },
  ]

  return (
    <div>
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
      ) : tab === 'comments' ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[840px] table-fixed text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-3 text-left font-medium w-[120px]">닉네임</th>
                <th className="px-3 py-3 text-left font-medium">내용</th>
                <th className="px-3 py-3 text-center font-medium w-[80px]">신고수</th>
                <th className="px-3 py-3 text-center font-medium w-[86px]">노출</th>
                <th className="px-3 py-3 text-left font-medium w-[110px]">작성일</th>
                <th className="px-3 py-3 text-center font-medium w-[180px]">액션</th>
              </tr>
            </thead>
            <tbody>
              {shownComments.map((c) => (
                <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50 [&>td]:whitespace-nowrap">
                  <td className="px-3 py-3 text-gray-700 text-xs truncate">{c.nickname}</td>
                  <td className="px-3 py-3">
                    <p className="text-gray-800 text-xs truncate" title={c.content}>
                      {c.parent_id ? '↳ ' : ''}{c.content}
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
                      <button onClick={() => blockAuthor('comment', c.id)} className="px-2 py-1 rounded-lg border border-orange-200 text-xs font-medium text-orange-600 hover:bg-orange-50">
                        차단
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
          <table className="w-full min-w-[980px] table-fixed text-sm">
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
                          {p.title}
                          {!!p.image_urls?.length && <span className="ml-1 text-gray-400">[사진 {p.image_urls.length}]</span>}
                        </p>
                      </button>
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-gray-600">{p.upvotes} / {p.downvotes}</td>
                    <td className="px-3 py-3 text-center text-xs text-gray-600">{p.comment_count}</td>
                    <td className="px-3 py-3 text-center">
                      {p.report_count > 0 || p.image_report_count > 0 ? (
                        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-xs font-semibold">
                          <Flag size={11} /> {p.report_count} / {p.image_report_count}
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
                        {!!p.image_urls?.length && (
                          <button onClick={() => toggleImage(p)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50">
                            <ImageOff size={12} /> {p.image_hidden ? '사진 복구' : '사진 가림'}
                          </button>
                        )}
                        <button onClick={() => blockAuthor('post', p.id)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-orange-200 text-xs font-medium text-orange-600 hover:bg-orange-50">
                          <ShieldBan size={12} /> 차단
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
                                  {r.target_type === 'image' ? '사진' : r.target_type === 'comment' ? '댓글' : '글'}
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
    </div>
  )
}
