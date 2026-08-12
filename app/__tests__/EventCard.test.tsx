import React from 'react'
import { render, fireEvent } from '@testing-library/react-native'
import EventCard from '@/components/EventCard'
import * as outlink from '@/lib/outlink'
import type { EventWithCompany } from '@/lib/supabase'

// expo-router mock
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }))

// expo-image mock
jest.mock('expo-image', () => ({
  Image: (props: any) => {
    const { View } = require('react-native')
    return <View testID="expo-image" />
  },
}))

// outlink mock
jest.mock('@/lib/outlink', () => ({ openOutlink: jest.fn() }))

// 색상은 목킹하지 않는다. 예전에는 단일 `Colors` 객체를 목으로 넣었는데, 다크/라이트
// 테마가 들어오면서 실제 모듈이 DarkColors/LightColors 를 내보내도록 바뀌었다. 목이
// 옛 이름 그대로라 themeStore 의 colors 가 undefined 가 됐고, 렌더가 전부 터졌다.
// (스위트 자체가 로드조차 안 되던 상태라 이 사실이 드러나지 않았다 — 2026-08-13)
// constants/colors 는 상수만 있는 순수 모듈이라 목이 필요 없다.

const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
const nearDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()

const mockEvent: EventWithCompany = {
  id: 'test-id',
  company_id: 'c1',
  external_id: null,
  title: '강남 와인 로테이션 소개팅 8:8',
  description: null,
  event_date: futureDate,
  location_region: '강남',
  location_detail: null,
  price_male: 40000,
  price_female: 35000,
  price_detail: null,
  gender_ratio: '8:8',
  capacity_male: 8,
  capacity_female: 8,
  seats_left_male: null,
  seats_left_female: null,
  theme: ['와인', '로테이션'],
  hashtags: ['#와인', '#로테이션', '#30대'],
  age_range_min: null,
  age_range_max: null,
  age_male: null,
  age_female: null,
  format: null,
  thumbnail_urls: ['https://example.com/img.jpg'],
  participant_stats: null,
  image_type_id: null,
  attendee_image_url: null,
  source_url: 'https://frip.co.kr/event/1',
  is_active: true,
  is_closed: false,
  crawled_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  companies: {
    id: 'c1',
    slug: 'frip',
    name: '프립',
    logo_url: null,
    base_url: 'https://frip.co.kr',
    crawl_url: 'https://frip.co.kr/events',
    crawl_type: 'static',
    regions: ['강남'],
    description: null,
    instagram_url: null,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
}

describe('EventCard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('이벤트 제목이 렌더링된다', () => {
    const { getByText } = render(<EventCard event={mockEvent} />)
    expect(getByText('강남 와인 로테이션 소개팅 8:8')).toBeTruthy()
  })

  it('업체명이 렌더링된다', () => {
    const { getByText } = render(<EventCard event={mockEvent} />)
    expect(getByText('프립')).toBeTruthy()
  })

  // 지역 앞의 📍 는 아이콘 컴포넌트로 바뀌었다 — 글자에는 지역명만 남는다.
  it('지역 정보가 렌더링된다', () => {
    const { getByText } = render(<EventCard event={mockEvent} />)
    expect(getByText('강남')).toBeTruthy()
  })

  // 가격은 PriceTierValue 가 그린다. '남/여' 라벨과 금액이 각각 다른 Text 로 나뉘어
  // 예전처럼 '남 40,000원' 한 덩어리로는 안 잡힌다.
  it('남녀 가격이 렌더링된다', () => {
    const { getAllByText } = render(<EventCard event={mockEvent} />)
    expect(getAllByText(/40,000/).length).toBeGreaterThan(0)
    expect(getAllByText(/35,000/).length).toBeGreaterThan(0)
  })

  // 테마는 ThemeBadge 가 대표 테마 하나만 배지로 보여준다(전부 나열하지 않는다).
  it('테마 배지가 렌더링된다', () => {
    const { getAllByText } = render(<EventCard event={mockEvent} />)
    expect(getAllByText(/와인|로테이션/).length).toBeGreaterThan(0)
  })

  it('신청하기 버튼 탭 시 openOutlink가 source_url로 호출된다', () => {
    const { getByText } = render(<EventCard event={mockEvent} />)
    fireEvent.press(getByText(/신청하기/))
    expect(outlink.openOutlink).toHaveBeenCalledWith('https://frip.co.kr/event/1')
  })

  it('D-2일 때 마감 임박 뱃지가 표시된다', () => {
    const nearEvent = { ...mockEvent, event_date: nearDate }
    const { getByText } = render(<EventCard event={nearEvent} />)
    expect(getByText(/D-2/)).toBeTruthy()
  })

  it('5일 후 이벤트는 마감 임박 뱃지가 없다', () => {
    const { queryByText } = render(<EventCard event={mockEvent} />)
    expect(queryByText(/D-/)).toBeNull()
  })

  // 썸네일이 없으면 이모지 대신 지역명을 얹은 자리표시자가 그려진다.
  it('thumbnail_urls가 없어도 카드가 정상 렌더링된다', () => {
    const noThumb = { ...mockEvent, thumbnail_urls: [] }
    const { getByText } = render(<EventCard event={noThumb} />)
    expect(getByText(mockEvent.title!)).toBeTruthy()
  })

  it('companies가 null이면 업체 배지가 없다', () => {
    const noCompany = { ...mockEvent, companies: null }
    const { queryByText } = render(<EventCard event={noCompany} />)
    expect(queryByText('프립')).toBeNull()
  })
})
