// moitbiz.com/partner 의 문구를 «화면에 보이는 그대로» 놓고 그 자리에서 고치는 화면.
// 오너 지시(2026-09-05): "admin에서 문구 자체를 그대로 보여주면 그 자리에서 직접 수정할게."
// 저장하면 즉시 실제 사이트에 반영된다.
import { useEffect, useState } from 'react'
import { Plus, Trash2, ArrowUp, ArrowDown, ExternalLink } from 'lucide-react'

const PAGE_URL = 'https://moitbiz.com/partner'

interface Item {
  title?: string
  desc?: string
  icon?: string
  q?: string
  a?: string
  label?: string
  href?: string
}
interface Tier {
  eyebrow: string
  title: string
  note: string
  items: Item[]
}
interface Content {
  meta: { title: string; description: string }
  hero: {
    eyebrow: string
    titleBefore: string
    titleHighlight: string
    titleAfter: string
    lead: string
    body: string
  }
  tiers: { heading: string; sub: string; free: Tier; paid: Tier }
  ask: { heading: string; items: Item[]; note: string }
  faq: { heading: string; items: Item[] }
  cta: {
    heading: string
    sub: string
    buttonLabel: string
    email: string
    mailSubject: string
    mailBody: string
  }
  footer: {
    tagline: string
    links: Item[]
    contactLabel: string
    company: string
    bizNumber: string
  }
}

const INPUT =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent'

function Field({
  label,
  hint,
  value,
  onChange,
  rows,
  placeholder,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {rows ? (
        <textarea
          value={value}
          rows={rows}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT} resize-y`}
        />
      ) : (
        <input
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT}
        />
      )}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

function Section({
  title,
  desc,
  children,
}: {
  title: string
  desc?: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="mb-4">
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
        {desc && <p className="text-xs text-gray-400 mt-0.5">{desc}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

/** 목록 한 칸의 위·아래 이동과 삭제. 모든 목록이 같은 방식으로 움직이게 한 곳에 뒀다. */
function ItemTools({
  index,
  total,
  onMove,
  onRemove,
}: {
  index: number
  total: number
  onMove: (from: number, to: number) => void
  onRemove: (i: number) => void
}) {
  const btn = 'p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30'
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <button className={btn} disabled={index === 0} onClick={() => onMove(index, index - 1)} title="위로">
        <ArrowUp size={15} />
      </button>
      <button
        className={btn}
        disabled={index === total - 1}
        onClick={() => onMove(index, index + 1)}
        title="아래로"
      >
        <ArrowDown size={15} />
      </button>
      <button
        className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600"
        onClick={() => onRemove(index)}
        title="삭제"
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
    >
      <Plus size={15} />
      {label}
    </button>
  )
}

export default function PartnerPage() {
  const [content, setContent] = useState<Content | null>(null)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    fetch('/api/site-content?key=partner', { credentials: 'include' })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error ?? 'load_failed')
        setContent(d.content)
      })
      .catch(() => setLoadError('문구를 불러오지 못했습니다. 새로고침해주세요.'))
  }, [])

  if (loadError) return <div className="p-4 md:p-8 text-sm text-red-500">{loadError}</div>
  if (!content) return <div className="p-4 md:p-8 text-sm text-gray-400">불러오는 중...</div>

  const c = content

  /** 깊은 곳 한 군데만 바꿔도 화면이 다시 그려지도록 통째로 새 객체를 만든다. */
  const edit = (fn: (draft: Content) => void) => {
    const next = JSON.parse(JSON.stringify(c)) as Content
    fn(next)
    setContent(next)
    setSaved(false)
  }

  const move = <T,>(arr: T[], from: number, to: number) => {
    const [x] = arr.splice(from, 1)
    arr.splice(to, 0, x)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError('')
    setSaved(false)
    try {
      const res = await fetch('/api/site-content', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'partner', content: c }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error ?? 'save_failed')
      setSaved(true)
    } catch {
      setSaveError('저장에 실패했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setSaving(false)
    }
  }

  const tierEditor = (which: 'free' | 'paid') => {
    const tier = c.tiers[which]
    return (
      <div className="border border-gray-200 rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="작은 영문 표시"
            value={tier.eyebrow}
            onChange={(v) => edit((d) => void (d.tiers[which].eyebrow = v))}
          />
          <Field
            label="등급 이름"
            value={tier.title}
            onChange={(v) => edit((d) => void (d.tiers[which].title = v))}
          />
        </div>
        <Field
          label="이름 아래 안내문"
          hint="비워두면 그 줄이 아예 안 나옵니다."
          value={tier.note}
          onChange={(v) => edit((d) => void (d.tiers[which].note = v))}
        />

        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">혜택 항목</p>
          <div className="space-y-3">
            {tier.items.map((it, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1 space-y-2 border border-gray-200 rounded-lg p-3">
                  <input
                    value={it.title ?? ''}
                    placeholder="굵게 나오는 제목"
                    onChange={(e) => edit((d) => void (d.tiers[which].items[i].title = e.target.value))}
                    className={`${INPUT} font-semibold`}
                  />
                  <textarea
                    value={it.desc ?? ''}
                    rows={2}
                    placeholder="그 아래 설명"
                    onChange={(e) => edit((d) => void (d.tiers[which].items[i].desc = e.target.value))}
                    className={`${INPUT} resize-y`}
                  />
                </div>
                <ItemTools
                  index={i}
                  total={tier.items.length}
                  onMove={(a, b) => edit((d) => move(d.tiers[which].items, a, b))}
                  onRemove={(x) => edit((d) => void d.tiers[which].items.splice(x, 1))}
                />
              </div>
            ))}
          </div>
          <div className="mt-3">
            <AddButton
              label="혜택 항목 추가"
              onClick={() => edit((d) => void d.tiers[which].items.push({ title: '', desc: '' }))}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">제휴 소개 페이지</h1>
        <p className="text-sm text-gray-500 leading-relaxed">
          업체에게 보여주는 제휴 안내 페이지의 문구입니다. 저장하면 실제 사이트에 바로 반영됩니다.
        </p>
        <a
          href={PAGE_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-pink-600 font-medium mt-2 hover:underline"
        >
          <ExternalLink size={14} />
          실제 페이지 열어보기
        </a>
      </div>

      <div className="space-y-5">
        <Section title="맨 위 인사말" desc="페이지를 열면 가장 먼저 보이는 부분입니다.">
          <Field
            label="작은 영문 표시"
            value={c.hero.eyebrow}
            onChange={(v) => edit((d) => void (d.hero.eyebrow = v))}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field
              label="큰 제목 첫 줄"
              value={c.hero.titleBefore}
              onChange={(v) => edit((d) => void (d.hero.titleBefore = v))}
            />
            <Field
              label="분홍색으로 강조할 말"
              value={c.hero.titleHighlight}
              onChange={(v) => edit((d) => void (d.hero.titleHighlight = v))}
            />
            <Field
              label="강조 뒤에 이어질 말"
              value={c.hero.titleAfter}
              onChange={(v) => edit((d) => void (d.hero.titleAfter = v))}
            />
          </div>
          <Field
            label="제목 아래 굵은 한 줄"
            rows={2}
            value={c.hero.lead}
            onChange={(v) => edit((d) => void (d.hero.lead = v))}
          />
          <Field
            label="서비스 설명"
            rows={4}
            value={c.hero.body}
            onChange={(v) => edit((d) => void (d.hero.body = v))}
          />
        </Section>

        <Section title="제휴 등급" desc="무료·유료 두 칸입니다. 항목을 자유롭게 추가·삭제할 수 있습니다.">
          <Field
            label="섹션 제목"
            value={c.tiers.heading}
            onChange={(v) => edit((d) => void (d.tiers.heading = v))}
          />
          <Field
            label="섹션 설명"
            value={c.tiers.sub}
            onChange={(v) => edit((d) => void (d.tiers.sub = v))}
          />
          <div>
            <p className="text-sm font-semibold text-gray-900 mb-2">왼쪽 칸 (무료)</p>
            {tierEditor('free')}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900 mb-2">오른쪽 칸 (유료, 분홍 테두리)</p>
            {tierEditor('paid')}
          </div>
        </Section>

        <Section title="대신 부탁드리는 것">
          <Field
            label="섹션 제목"
            value={c.ask.heading}
            onChange={(v) => edit((d) => void (d.ask.heading = v))}
          />
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">항목</p>
            <div className="space-y-3">
              {c.ask.items.map((it, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="flex-1 space-y-2 border border-gray-200 rounded-lg p-3">
                    <input
                      value={it.title ?? ''}
                      placeholder="굵게 나오는 제목"
                      onChange={(e) => edit((d) => void (d.ask.items[i].title = e.target.value))}
                      className={`${INPUT} font-semibold`}
                    />
                    <textarea
                      value={it.desc ?? ''}
                      rows={2}
                      placeholder="이어지는 설명"
                      onChange={(e) => edit((d) => void (d.ask.items[i].desc = e.target.value))}
                      className={`${INPUT} resize-y`}
                    />
                    <input
                      value={it.icon ?? ''}
                      placeholder="아이콘 이름 (예: favorite, local_bar)"
                      onChange={(e) => edit((d) => void (d.ask.items[i].icon = e.target.value))}
                      className={`${INPUT} text-gray-500`}
                    />
                  </div>
                  <ItemTools
                    index={i}
                    total={c.ask.items.length}
                    onMove={(a, b) => edit((d) => move(d.ask.items, a, b))}
                    onRemove={(x) => edit((d) => void d.ask.items.splice(x, 1))}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3">
              <AddButton
                label="항목 추가"
                onClick={() => edit((d) => void d.ask.items.push({ title: '', desc: '', icon: 'check_circle' }))}
              />
            </div>
          </div>
          <Field
            label="맨 아래 작은 글씨"
            value={c.ask.note}
            onChange={(v) => edit((d) => void (d.ask.note = v))}
          />
        </Section>

        <Section title="자주 묻는 질문">
          <Field
            label="섹션 제목"
            value={c.faq.heading}
            onChange={(v) => edit((d) => void (d.faq.heading = v))}
          />
          <div className="space-y-3">
            {c.faq.items.map((it, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1 space-y-2 border border-gray-200 rounded-lg p-3">
                  <input
                    value={it.q ?? ''}
                    placeholder="질문"
                    onChange={(e) => edit((d) => void (d.faq.items[i].q = e.target.value))}
                    className={`${INPUT} font-semibold`}
                  />
                  <textarea
                    value={it.a ?? ''}
                    rows={2}
                    placeholder="답변"
                    onChange={(e) => edit((d) => void (d.faq.items[i].a = e.target.value))}
                    className={`${INPUT} resize-y`}
                  />
                </div>
                <ItemTools
                  index={i}
                  total={c.faq.items.length}
                  onMove={(a, b) => edit((d) => move(d.faq.items, a, b))}
                  onRemove={(x) => edit((d) => void d.faq.items.splice(x, 1))}
                />
              </div>
            ))}
          </div>
          <AddButton label="질문 추가" onClick={() => edit((d) => void d.faq.items.push({ q: '', a: '' }))} />
        </Section>

        <Section title="맨 아래 문의 안내" desc="버튼을 누르면 여기 적은 주소로 메일 쓰기 창이 열립니다.">
          <Field
            label="제목"
            value={c.cta.heading}
            onChange={(v) => edit((d) => void (d.cta.heading = v))}
          />
          <Field label="설명" value={c.cta.sub} onChange={(v) => edit((d) => void (d.cta.sub = v))} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="버튼 글씨"
              value={c.cta.buttonLabel}
              onChange={(v) => edit((d) => void (d.cta.buttonLabel = v))}
            />
            <Field
              label="받는 메일 주소"
              value={c.cta.email}
              onChange={(v) => edit((d) => void (d.cta.email = v))}
            />
          </div>
          <Field
            label="메일 제목 (자동으로 채워짐)"
            value={c.cta.mailSubject}
            onChange={(v) => edit((d) => void (d.cta.mailSubject = v))}
          />
          <Field
            label="메일 본문 (자동으로 채워짐)"
            hint="업체가 메일 창을 열었을 때 미리 적혀 있는 내용입니다."
            rows={8}
            value={c.cta.mailBody}
            onChange={(v) => edit((d) => void (d.cta.mailBody = v))}
          />
        </Section>

        <Section title="맨 아래 회사 정보">
          <Field
            label="로고 옆 한 줄"
            value={c.footer.tagline}
            onChange={(v) => edit((d) => void (d.footer.tagline = v))}
          />
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">링크</p>
            <div className="space-y-2">
              {c.footer.links.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={l.label ?? ''}
                    placeholder="보이는 글씨"
                    onChange={(e) => edit((d) => void (d.footer.links[i].label = e.target.value))}
                    className={INPUT}
                  />
                  <input
                    value={l.href ?? ''}
                    placeholder="/terms"
                    onChange={(e) => edit((d) => void (d.footer.links[i].href = e.target.value))}
                    className={`${INPUT} text-gray-500`}
                  />
                  <ItemTools
                    index={i}
                    total={c.footer.links.length}
                    onMove={(a, b) => edit((d) => move(d.footer.links, a, b))}
                    onRemove={(x) => edit((d) => void d.footer.links.splice(x, 1))}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3">
              <AddButton
                label="링크 추가"
                onClick={() => edit((d) => void d.footer.links.push({ label: '', href: '/' }))}
              />
            </div>
          </div>
          <Field
            label="'문의' 라벨"
            value={c.footer.contactLabel}
            onChange={(v) => edit((d) => void (d.footer.contactLabel = v))}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="회사명"
              value={c.footer.company}
              onChange={(v) => edit((d) => void (d.footer.company = v))}
            />
            <Field
              label="사업자등록번호 줄"
              value={c.footer.bizNumber}
              onChange={(v) => edit((d) => void (d.footer.bizNumber = v))}
            />
          </div>
        </Section>

        <Section title="검색·공유용 정보" desc="검색 결과나 카톡으로 링크를 보낼 때 보이는 글입니다.">
          <Field
            label="페이지 제목"
            value={c.meta.title}
            onChange={(v) => edit((d) => void (d.meta.title = v))}
          />
          <Field
            label="페이지 설명"
            rows={2}
            value={c.meta.description}
            onChange={(v) => edit((d) => void (d.meta.description = v))}
          />
        </Section>
      </div>

      <div className="flex items-center gap-3 mt-6 pb-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 rounded-xl bg-pink-500 text-white text-sm font-semibold hover:bg-pink-600 disabled:opacity-60"
        >
          {saving ? '저장 중...' : '저장하고 사이트에 반영'}
        </button>
        {saved && <span className="text-sm text-green-600">저장됐습니다. 실제 사이트에 바로 반영됐습니다.</span>}
        {saveError && <span className="text-sm text-red-500">{saveError}</span>}
      </div>
    </div>
  )
}
