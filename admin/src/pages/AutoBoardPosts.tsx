import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, RefreshCw, Save, Send, Trash2, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Status = 'draft' | 'ready' | 'scheduled' | 'published' | 'rejected' | 'failed'

interface AutoPost {
  id: string
  nickname: string
  title: string
  content: string
  avatar_id: string | null
  tag_id: string | null
  source_type: string
  source_url: string | null
  source_title: string | null
  status: Status
  scheduled_at: string | null
  published_post_id: string | null
  generation_model: string | null
  generation_notes: string | null
  created_at: string
  updated_at: string
}

interface BoardTag { id: string; label: string }

type Filter = 'all' | Status

const STATUS_LABEL: Record<Status, string> = {
  draft: '검토 대기',
  ready: '승인됨',
  scheduled: '예약됨',
  published: '게시됨',
  rejected: '반려됨',
  failed: '실패',
}

const EMPTY = { nickname: '', title: '', content: '', tag_id: '' }
const randomAvatarId = () => `thumbs_${String(1 + Math.floor(Math.random() * 24)).padStart(2, '0')}`

export default function AutoBoardPosts() {
  const [posts, setPosts] = useState<AutoPost[]>([])
  const [tags, setTags] = useState<BoardTag[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)

  async function load() {
    setLoading(true)
    const [p, t] = await Promise.all([
      supabase.from('auto_board_posts').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('board_tags').select('id,label').order('sort_order', { ascending: true }),
    ])
    if (p.error) setMsg(`불러오기 실패: ${p.error.message}`)
    setPosts((p.data as AutoPost[]) ?? [])
    setTags((t.data as BoardTag[]) ?? [])
    setLoading(false)
  }

  // 최초 한 번만 읽는다. 이후에는 화면의 새로고침 버튼으로 명시적으로 다시 읽는다.
  useEffect(() => { void load() }, [])

  function patchLocal(id: string, patch: Partial<AutoPost>) {
    setPosts((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p))
  }

  async function createDraft() {
    const nickname = form.nickname.trim()
    const title = form.title.trim()
    const content = form.content.trim()
    if (nickname.length < 2) { alert('닉네임을 2자 이상 입력하세요.'); return }
    if (!title || !content) { alert('제목과 내용을 입력하세요.'); return }
    setBusy('초안을 저장하는 중입니다')
    const { data, error } = await supabase.from('auto_board_posts').insert({
      nickname, title, content,
      avatar_id: randomAvatarId(),
      tag_id: form.tag_id || null,
      source_type: 'manual',
      status: 'draft',
      generation_notes: 'admin에서 직접 작성',
    }).select('*').single()
    setBusy(null)
    if (error) { alert(`저장 실패: ${error.message}`); return }
    setPosts((prev) => [data as AutoPost, ...prev])
    setForm(EMPTY)
    setCreateOpen(false)
    setMsg('초안을 저장했습니다.')
  }

  async function save(post: AutoPost) {
    const nickname = post.nickname.trim()
    const title = post.title.trim()
    const content = post.content.trim()
    if (nickname.length < 2 || !title || !content) { alert('닉네임·제목·내용을 확인하세요.'); return }
    setBusy('수정 내용을 저장하는 중입니다')
    const patch = { nickname, title, content, tag_id: post.tag_id || null, updated_at: new Date().toISOString() }
    const { error } = await supabase.from('auto_board_posts').update(patch).eq('id', post.id)
    let publicError: string | null = null
    if (!error && post.published_post_id) {
      const r = await supabase.from('board_posts').update({
        nickname, title, content, tag_id: post.tag_id || null,
      }).eq('id', post.published_post_id)
      publicError = r.error?.message ?? null
    }
    setBusy(null)
    if (error || publicError) { alert(`저장 실패: ${error?.message ?? publicError}`); return }
    patchLocal(post.id, patch)
    setMsg(post.published_post_id ? '앱에 게시된 글까지 수정했습니다.' : '수정 내용을 저장했습니다.')
  }

  async function publish(post: AutoPost) {
    if (!window.confirm(`'${post.title}' 글을 지금 앱에 게시할까요?`)) return
    setBusy('앱에 게시하는 중입니다')
    const { data, error } = await supabase.rpc('publish_auto_board_post', { p_id: post.id })
    setBusy(null)
    if (error) { alert(`게시 실패: ${error.message}`); return }
    patchLocal(post.id, { status: 'published', published_post_id: String(data), updated_at: new Date().toISOString() })
    setMsg('앱 커뮤니티에 게시했습니다.')
  }

  async function reject(post: AutoPost) {
    if (!window.confirm(`'${post.title}' 초안을 반려할까요?`)) return
    setBusy('초안을 반려하는 중입니다')
    const { error } = await supabase.from('auto_board_posts')
      .update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', post.id)
    setBusy(null)
    if (error) { alert(`반려 실패: ${error.message}`); return }
    patchLocal(post.id, { status: 'rejected' })
    setMsg('초안을 반려했습니다.')
  }

  async function remove(post: AutoPost) {
    const message = post.published_post_id
      ? `'${post.title}' 글을 앱에서 삭제할까요? 자동 생성 이력은 admin에 남습니다.`
      : `'${post.title}' 초안을 완전히 삭제할까요? 복구할 수 없습니다.`
    if (!window.confirm(message)) return
    setBusy(post.published_post_id ? '앱 게시글을 삭제하는 중입니다' : '초안을 삭제하는 중입니다')
    if (post.published_post_id) {
      const { error } = await supabase.from('board_posts').delete().eq('id', post.published_post_id)
      if (!error) {
        await supabase.from('auto_board_posts').update({
          status: 'rejected', published_post_id: null, updated_at: new Date().toISOString(),
        }).eq('id', post.id)
      }
      setBusy(null)
      if (error) { alert(`삭제 실패: ${error.message}`); return }
      patchLocal(post.id, { status: 'rejected', published_post_id: null })
      setMsg('앱 게시글을 삭제했습니다. 생성 이력은 남겼습니다.')
      return
    }
    const { error } = await supabase.from('auto_board_posts').delete().eq('id', post.id)
    setBusy(null)
    if (error) { alert(`삭제 실패: ${error.message}`); return }
    setPosts((prev) => prev.filter((x) => x.id !== post.id))
    setMsg('초안을 삭제했습니다.')
  }

  const filtered = useMemo(
    () => filter === 'all' ? posts : posts.filter((p) => p.status === filter),
    [filter, posts],
  )
  const count = (status: Status) => posts.filter((p) => p.status === status).length

  return (
    <div className="p-4 md:p-8">
      {busy && (
        <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl px-6 py-5 flex items-center gap-3 shadow-xl">
            <Loader2 size={20} className="animate-spin text-pink-500" />
            <span className="text-sm font-bold text-gray-800">{busy}</span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">자동 게시 관리</h1>
          <p className="text-sm text-gray-500 mt-1">자동 생성 글을 확인·수정한 뒤 직접 앱에 게시합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600">
            <RefreshCw size={15} /> 새로고침
          </button>
          <button onClick={() => setCreateOpen((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg bg-pink-500 px-3 py-2 text-sm font-medium text-white">
            <Plus size={15} /> 직접 초안 추가
          </button>
        </div>
      </div>

      {msg && <div className="mb-4 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">{msg}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <Summary label="전체" value={posts.length} />
        <Summary label="검토 대기" value={count('draft')} />
        <Summary label="게시됨" value={count('published')} />
        <Summary label="반려·실패" value={count('rejected') + count('failed')} />
      </div>

      {createOpen && (
        <div className="mb-4 rounded-xl border border-pink-200 bg-white p-4 space-y-3">
          <h2 className="text-sm font-bold">직접 초안 추가</h2>
          <div className="grid md:grid-cols-2 gap-3">
            <input value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} placeholder="닉네임" maxLength={12} className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            <select value={form.tag_id} onChange={(e) => setForm({ ...form, tag_id: e.target.value })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white">
              <option value="">말머리 없음</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="제목" maxLength={60} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="내용" rows={6} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <div className="flex items-center gap-2">
            <button onClick={() => void createDraft()} className="rounded-lg bg-pink-500 px-4 py-2 text-sm font-medium text-white">초안 저장</button>
            <button onClick={() => setCreateOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600">취소</button>
          </div>
        </div>
      )}

      <div className="tab-scroll flex items-center gap-2 mb-4 border-b border-gray-200">
        {([
          ['all', '전체'], ['draft', '검토 대기'], ['published', '게시됨'],
          ['rejected', '반려됨'], ['failed', '실패'],
        ] as [Filter, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)} className={`shrink-0 whitespace-nowrap px-4 py-2.5 text-sm font-bold -mb-px border-b-2 ${filter === key ? 'border-pink-500 text-pink-600' : 'border-transparent text-gray-400'}`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">불러오는 중...</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-400">해당하는 자동 게시글이 없습니다.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((post) => (
            <article key={post.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-1 font-bold ${post.status === 'published' ? 'bg-green-50 text-green-700' : post.status === 'draft' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{STATUS_LABEL[post.status]}</span>
                  <span className="text-gray-400">{new Date(post.created_at).toLocaleString('ko-KR')}</span>
                  {post.generation_notes && <span className="text-gray-400">{post.generation_notes}</span>}
                </div>
                {post.source_url && <a href={post.source_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline">참고 자료 열기</a>}
              </div>

              <div className="grid md:grid-cols-[180px_1fr] gap-3 mb-3">
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-500">닉네임</label>
                  <input value={post.nickname} onChange={(e) => patchLocal(post.id, { nickname: e.target.value })} maxLength={12} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                  <label className="block text-xs font-medium text-gray-500">말머리</label>
                  <select value={post.tag_id ?? ''} onChange={(e) => patchLocal(post.id, { tag_id: e.target.value || null })} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white">
                    <option value="">말머리 없음</option>
                    {tags.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-500">제목</label>
                  <input value={post.title} onChange={(e) => patchLocal(post.id, { title: e.target.value })} maxLength={60} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold" />
                  <label className="block text-xs font-medium text-gray-500">내용</label>
                  <textarea value={post.content} onChange={(e) => patchLocal(post.id, { content: e.target.value })} rows={6} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm leading-6" />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                <button onClick={() => void save(post)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700"><Save size={15} /> 수정 저장</button>
                {!post.published_post_id && post.status !== 'rejected' && (
                  <button onClick={() => void publish(post)} className="inline-flex items-center gap-1.5 rounded-lg bg-pink-500 px-3 py-2 text-sm font-medium text-white"><Send size={15} /> 지금 게시</button>
                )}
                {!post.published_post_id && post.status !== 'rejected' && (
                  <button onClick={() => void reject(post)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-500"><XCircle size={15} /> 반려</button>
                )}
                <button onClick={() => void remove(post)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600"><Trash2 size={15} /> {post.published_post_id ? '앱에서 삭제' : '초안 삭제'}</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-gray-200 bg-white p-3"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-xl font-bold text-gray-900">{value}</p></div>
}
