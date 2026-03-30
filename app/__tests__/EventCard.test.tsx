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

// @/constants/colors mock
jest.mock('@/constants/colors', () => ({
  Colors: {
    surface: '#1A1A1A',
    surfaceHigh: '#2A2A2A',
    primary: '#FF6B9D',
    textPrimary: '#FFFFFF',
    textSecondary: '#999999',
  },
}))

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
  gender_ratio: '8:8',
  capacity_male: 8,
  capacity_female: 8,
  seats_left_male: null,
  seats_left_female: null,
  theme: ['와인', '로테이션'],
  age_range_min: null,
  age_range_max: null,
  format: null,
  thumbnail_urls: ['https://example.com/img.jpg'],
  participant_stats: null,
  source_url: 'https://lovematching.kr/event/1',
  is_active: true,
  is_closed: false,
  crawled_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  companies: {
    id: 'c1',
    slug: 'lovematching',
    name: '러브매칭',
    logo_url: null,
    base_url: 'https://lovematching.kr',
    crawl_url: 'https://lovematching.kr/events',
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
    expect(getByText('러브매칭')).toBeTruthy()
  })

  it('지역 정보가 렌더링된다', () => {
    const { getByText } = render(<EventCard event={mockEvent} />)
    expect(getByText('📍 강남')).toBeTruthy()
  })

  it('남성 가격이 렌더링된다', () => {
    const { getByText } = render(<EventCard event={mockEvent} />)
    expect(getByText('남 40,000원')).toBeTruthy()
  })

  it('여성 가격이 렌더링된다', () => {
    const { getByText } = render(<EventCard event={mockEvent} />)
    expect(getByText('여 35,000원')).toBeTruthy()
  })

  it('테마 태그가 렌더링된다', () => {
    const { getByText } = render(<EventCard event={mockEvent} />)
    expect(getByText('와인')).toBeTruthy()
    expect(getByText('로테이션')).toBeTruthy()
  })

  it('신청하기 버튼 탭 시 openOutlink가 source_url로 호출된다', () => {
    const { getByText } = render(<EventCard event={mockEvent} />)
    fireEvent.press(getByText('신청하기 →'))
    expect(outlink.openOutlink).toHaveBeenCalledWith('https://lovematching.kr/event/1')
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

  it('thumbnail_urls가 없으면 플레이스홀더가 렌더링된다', () => {
    const noThumb = { ...mockEvent, thumbnail_urls: [] }
    const { getByText } = render(<EventCard event={noThumb} />)
    expect(getByText('💑')).toBeTruthy()
  })

  it('companies가 null이면 업체 배지가 없다', () => {
    const noCompany = { ...mockEvent, companies: null }
    const { queryByText } = render(<EventCard event={noCompany} />)
    expect(queryByText('러브매칭')).toBeNull()
  })
})
