// 앱 실제 화면을 옮긴 미리보기. 앱에는 목록 보기가 두 가지(카드형·피드형) 있고
// 거기에 상세 화면까지 세 가지를 그대로 보여준다.
//   카드형  = app/components/EventCard.tsx      (사진이 위, 가로 꽉, 높이 200)
//   피드형  = app/components/EventListItem.tsx  (왼쪽 88x88 사진 + 오른쪽 글)
//   상세    = app/app/event/[id].tsx
// 색상은 app/constants/colors.ts LightColors.

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
  detailImages: string[]
  eventDate: string
  region: string
  priceMale: string
  priceFemale: string
  partnerPriceMale: string
  partnerPriceFemale: string
  seatsLeftMale: string
  seatsLeftFemale: string
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

/** 앱과 같은 규칙: 잔여석이 0 이하면 그 성별은 마감으로 본다. */
function isSoldOut(seats: string): boolean {
  if (seats.trim() === '') return false
  const n = Number(seats)
  return !Number.isNaN(n) && n <= 0
}

/** 앱의 PriceTierValue 와 같은 표시 — 마감이면 취소선 + (마감),
    모잇 할인가가 있으면 정가에 줄을 긋고 할인가를 분홍으로. */
function PriceValue({
  price,
  discount,
  sold,
  small,
}: {
  price: string | null
  discount?: string | null
  sold: boolean
  small?: boolean
}) {
  const size = small ? 12.5 : 13
  if (!price) {
    return sold ? <span style={{ fontSize: size, color: COLORS.textTertiary }}>마감</span> : null
  }
  if (sold) {
    // 마감이면 할인가는 의미가 없다 — 앱과 같이 마감 표시가 이긴다.
    return (
      <span style={{ fontSize: size, color: COLORS.textTertiary, textDecoration: 'line-through' }}>
        {price} (마감)
      </span>
    )
  }
  if (discount) {
    return (
      <>
        <span style={{ fontSize: size - 1, color: COLORS.textTertiary, textDecoration: 'line-through' }}>
          {price}
        </span>
        <span style={{ fontSize: size, fontWeight: 700, color: COLORS.primary, marginLeft: 5 }}>{discount}</span>
      </>
    )
  }
  return <span style={{ fontSize: size, fontWeight: 700, color: COLORS.primary }}>{price}</span>
}

function GenderRow({
  label,
  price,
  discount,
  sold,
  small,
}: {
  label: string
  price: string | null
  discount?: string | null
  sold: boolean
  small?: boolean
}) {
  if (!price && !sold) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
      <span
        style={{
          width: small ? 28 : 30,
          fontSize: small ? 12.5 : 13,
          fontWeight: 700,
          color: COLORS.textPrimary,
        }}
      >
        {label}
      </span>
      <PriceValue price={price} discount={discount} sold={sold} small={small} />
    </div>
  )
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

function ImageBox({ url, aspect, height }: { url: string | null; aspect?: string; height?: number }) {
  return (
    <div
      style={{
        width: '100%',
        aspectRatio: aspect,
        height,
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

function Hashtags({ tags, tight }: { tags: string[]; tight?: boolean }) {
  if (!tags.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: tight ? 4 : 8 }}>
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

/** 카드형 — 사진이 위에 크게 깔리는 모양. */
export function CardPreview({ data }: { data: PreviewData }) {
  const soldM = isSoldOut(data.seatsLeftMale)
  const soldF = isSoldOut(data.seatsLeftFemale)
  return (
    <div style={{ background: COLORS.background, padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <div
        style={{
          background: COLORS.surface,
          borderRadius: 16,
          border: `1px solid ${COLORS.border}`,
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'relative' }}>
          <ImageBox url={data.imageUrl} height={200} />
          <div style={{ position: 'absolute', top: 10, left: 10 }}>
            <Badge />
          </div>
        </div>
        <div style={{ padding: 16 }}>
          <p
            style={{
              margin: 0,
              fontSize: 16,
              lineHeight: '21px',
              fontWeight: 700,
              color: COLORS.textPrimary,
            }}
          >
            {data.title || '모임 제목'}
          </p>
          <Hashtags tags={data.hashtags} />
          <p style={{ margin: '6px 0 0', fontSize: 13, color: COLORS.textTertiary }}>
            {formatDate(data.eventDate)} · {data.region || '지역 미정'}
          </p>
          <div style={{ marginTop: 6 }}>
            <GenderRow label="남성" price={won(data.priceMale)} discount={won(data.partnerPriceMale)} sold={soldM} />
            <GenderRow label="여성" price={won(data.priceFemale)} discount={won(data.partnerPriceFemale)} sold={soldF} />
          </div>
          <div
            style={{
              marginTop: 12,
              padding: '10px 0',
              borderRadius: 10,
              background: COLORS.primary,
              color: '#fff',
              fontSize: 14,
              fontWeight: 700,
              textAlign: 'center',
            }}
          >
            신청하기 ›
          </div>
        </div>
      </div>
    </div>
  )
}

/** 피드형 — 왼쪽에 작은 사진, 오른쪽에 글이 붙는 한 줄 모양. */
export function FeedPreview({ data }: { data: PreviewData }) {
  const soldM = isSoldOut(data.seatsLeftMale)
  const soldF = isSoldOut(data.seatsLeftFemale)
  return (
    <div style={{ background: COLORS.background, padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <div
        style={{
          background: COLORS.surface,
          borderRadius: 12,
          border: `1px solid ${COLORS.border}`,
          padding: 12,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
        }}
      >
        <div style={{ width: 88, flexShrink: 0 }}>
          <div style={{ width: 88, height: 88, borderRadius: 10, overflow: 'hidden' }}>
            <ImageBox url={data.imageUrl} />
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 4 }}>
            <Badge />
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: '19px',
              fontWeight: 700,
              color: COLORS.textPrimary,
            }}
          >
            {data.title || '모임 제목'}
          </p>
          <Hashtags tags={data.hashtags} tight />
          <p style={{ margin: '4px 0 0', fontSize: 12, color: COLORS.textTertiary }}>
            {formatDate(data.eventDate)} · {data.region || '지역 미정'}
          </p>
          <div style={{ marginTop: 4 }}>
            <GenderRow label="남성" price={won(data.priceMale)} discount={won(data.partnerPriceMale)} sold={soldM} small />
            <GenderRow label="여성" price={won(data.priceFemale)} discount={won(data.partnerPriceFemale)} sold={soldF} small />
          </div>
        </div>
      </div>
    </div>
  )
}

/** 눌렀을 때 보이는 상세 화면. */
export function DetailPreview({ data }: { data: PreviewData }) {
  const soldM = isSoldOut(data.seatsLeftMale)
  const soldF = isSoldOut(data.seatsLeftFemale)
  const male = won(data.priceMale)
  const female = won(data.priceFemale)
  const discM = won(data.partnerPriceMale)
  const discF = won(data.partnerPriceFemale)
  // 마감된 성별의 할인가는 앱에서도 안 보이므로 안내 줄 조건에서 빼야 한다.
  const showNotice = (!!discM && !soldM) || (!!discF && !soldF)
  return (
    <div style={{ background: COLORS.background, fontFamily: 'system-ui, sans-serif' }}>
      <ImageBox url={data.imageUrl} aspect="4/3" />
      <div style={{ padding: 16 }}>
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
          <p style={{ margin: '0 0 8px', fontSize: 12, color: COLORS.textTertiary }}>참가비</p>
          <div style={{ display: 'flex', gap: 24 }}>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: COLORS.textSecondary }}>남성</p>
              <div style={{ marginTop: 2 }}>
                {male || soldM ? (
                  <PriceValue price={male} discount={discM} sold={soldM} />
                ) : (
                  <span style={{ fontSize: 13, color: COLORS.textTertiary }}>미정</span>
                )}
              </div>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: COLORS.textSecondary }}>여성</p>
              <div style={{ marginTop: 2 }}>
                {female || soldF ? (
                  <PriceValue price={female} discount={discF} sold={soldF} />
                ) : (
                  <span style={{ fontSize: 13, color: COLORS.textTertiary }}>미정</span>
                )}
              </div>
            </div>
          </div>

          {/* 할인가를 보여줄 땐 «무엇을 해야 그 가격을 받는지»를 같이 알려준다(오너 지시). */}
          {showNotice && (
            <div
              style={{
                marginTop: 12,
                padding: '11px 13px',
                borderRadius: 10,
                border: `1.5px solid ${COLORS.primary}`,
                background: 'rgba(255,107,157,0.10)',
              }}
            >
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: COLORS.textSecondary, fontWeight: 600 }}>
                신청하실 때 <span style={{ color: COLORS.primary, fontWeight: 800 }}>&quot;모잇 통해서 신청&quot;</span>
                이라고 알려주셔야 이 가격으로 받으실 수 있어요
              </p>
            </div>
          )}
        </div>

        {data.description && (
          <div style={{ marginTop: 20 }}>
            <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: COLORS.textPrimary }}>
              모임 소개
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 14,
                color: COLORS.textSecondary,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              }}
            >
              {data.description}
            </p>
          </div>
        )}

        {data.detailImages.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: COLORS.textPrimary }}>
              상세 설명
            </p>
            {/* 앱은 상세 이미지들을 위아래로 빈틈없이 붙여 한 장처럼 보이게 한다. */}
            <div style={{ borderRadius: 12, overflow: 'hidden' }}>
              {data.detailImages.map((uri, i) => (
                <img key={`${uri}-${i}`} src={uri} alt="" style={{ width: '100%', display: 'block' }} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
