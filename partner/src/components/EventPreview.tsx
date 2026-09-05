// 앱 실제 화면(app/components/EventCard.tsx, app/app/event/[id].tsx)의 색상·구조를
// 최대한 그대로 옮긴 미리보기. 픽셀 단위 동일은 아니지만 업체가 "이렇게 보이겠구나"를
// 바로 감 잡을 수 있게 만드는 게 목적이다. 색상은 app/constants/colors.ts LightColors.

const COLORS = {
  background: '#F5F5F5',
  surface: '#FFFFFF',
  primary: '#FF6B9D',
  textPrimary: '#111111',
  textSecondary: '#555555',
  textTertiary: '#999999',
  border: '#E5E5E5',
  tagBackground: '#EFEFEF',
  tagText: '#555555',
}

export interface PreviewData {
  title: string
  description: string
  imageUrl: string | null
  eventDate: string
  region: string
  priceMale: string
  priceFemale: string
  hashtags: string[]
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return '날짜 미정'
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`
}

function won(v: string): string | null {
  const n = Number(v)
  if (!v || Number.isNaN(n)) return null
  return `${n.toLocaleString()}원`
}

function Badge() {
  return (
    <span
      style={{
        display: 'inline-block',
        background: COLORS.primary,
        color: '#fff',
        fontSize: 11,
        fontWeight: 700,
        padding: '3px 8px',
        borderRadius: 6,
        letterSpacing: 0.2,
      }}
    >
      모잇 Pick
    </span>
  )
}

function ImageBox({ url, aspect }: { url: string | null; aspect: string }) {
  return (
    <div
      style={{
        width: '100%',
        aspectRatio: aspect,
        background: '#E8E8E8',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {url ? (
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span style={{ fontSize: 12, color: COLORS.textTertiary }}>사진 없음</span>
      )}
    </div>
  )
}

function Hashtags({ tags }: { tags: string[] }) {
  if (!tags.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {tags.map((t) => (
        <span
          key={t}
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: COLORS.tagText,
            background: COLORS.tagBackground,
            padding: '3px 8px',
            borderRadius: 999,
          }}
        >
          #{t}
        </span>
      ))}
    </div>
  )
}

/** 피드에서 보이는 카드 모양. */
export function CardPreview({ data }: { data: PreviewData }) {
  const male = won(data.priceMale)
  const female = won(data.priceFemale)
  return (
    <div style={{ background: COLORS.background, padding: 16, borderRadius: 12 }}>
      <div
        style={{
          background: COLORS.surface,
          borderRadius: 16,
          border: `1px solid ${COLORS.border}`,
          overflow: 'hidden',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ position: 'relative' }}>
          <ImageBox url={data.imageUrl} aspect="16/10" />
          <div style={{ position: 'absolute', top: 8, left: 8 }}>
            <Badge />
          </div>
        </div>
        <div style={{ padding: 14 }}>
          <p
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 700,
              color: COLORS.textPrimary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {data.title || '모임 제목'}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: COLORS.textTertiary }}>
            {formatDate(data.eventDate)} · {data.region || '지역 미정'}
          </p>
          <Hashtags tags={data.hashtags} />
          {(male || female) && (
            <div
              style={{
                display: 'flex',
                gap: 16,
                marginTop: 10,
                paddingTop: 10,
                borderTop: `1px solid ${COLORS.border}`,
              }}
            >
              {male && (
                <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.textPrimary }}>
                  남 <span style={{ color: COLORS.primary }}>{male}</span>
                </span>
              )}
              {female && (
                <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.textPrimary }}>
                  여 <span style={{ color: COLORS.primary }}>{female}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 눌렀을 때 보이는 상세 화면 모양. */
export function DetailPreview({ data }: { data: PreviewData }) {
  const male = won(data.priceMale)
  const female = won(data.priceFemale)
  return (
    <div style={{ background: COLORS.background, borderRadius: 12, overflow: 'hidden' }}>
      <ImageBox url={data.imageUrl} aspect="4/3" />
      <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ marginBottom: 8 }}>
          <Badge />
        </div>
        <p style={{ margin: 0, fontSize: 19, fontWeight: 800, color: COLORS.textPrimary, lineHeight: 1.3 }}>
          {data.title || '모임 제목'}
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: COLORS.textSecondary }}>
          {formatDate(data.eventDate)} · {data.region || '지역 미정'}
        </p>
        <Hashtags tags={data.hashtags} />

        <div
          style={{
            marginTop: 16,
            padding: 14,
            background: COLORS.surface,
            borderRadius: 12,
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <p style={{ margin: 0, fontSize: 12, color: COLORS.textTertiary, marginBottom: 8 }}>참가비</p>
          <div style={{ display: 'flex', gap: 20 }}>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: COLORS.textSecondary }}>남성</p>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: COLORS.textPrimary }}>
                {male ?? '미정'}
              </p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: COLORS.textSecondary }}>여성</p>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: COLORS.textPrimary }}>
                {female ?? '미정'}
              </p>
            </div>
          </div>
        </div>

        {data.description && (
          <div style={{ marginTop: 16 }}>
            <p style={{ margin: 0, fontSize: 12, color: COLORS.textTertiary, marginBottom: 6 }}>소개</p>
            <p style={{ margin: 0, fontSize: 14, color: COLORS.textPrimary, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {data.description}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
