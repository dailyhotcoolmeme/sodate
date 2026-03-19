# APP.md — 앱 개발 에이전트 지시서

## 역할
Expo(React Native) 앱의 모든 화면, 컴포넌트, 상태관리, Supabase 연동을 담당합니다.

## 전제조건
- ARCH 완료 (폴더 구조, 의존성)
- DB 완료 (database.types.ts 생성)
- `docs/PRD.md` UX 가이드라인 반드시 숙지

---

## 디자인 토큰 (PRD 기반)

### `app/constants/colors.ts`
```typescript
export const Colors = {
  // 배경
  background: '#0F0F0F',      // 메인 배경 (다크)
  surface: '#1A1A1A',         // 카드 배경
  surfaceHigh: '#242424',     // 높은 레이어

  // 브랜드
  primary: '#FF6B9D',         // 핑크 (CTA, 포인트)
  primaryDark: '#E05585',
  secondary: '#9B59F5',       // 퍼플 (보조)

  // 텍스트
  textPrimary: '#FFFFFF',
  textSecondary: '#A0A0A0',
  textTertiary: '#606060',

  // 상태
  success: '#4CAF50',
  warning: '#FF9800',
  error: '#F44336',
  deadline: '#FF4444',        // 마감 임박

  // 구분선
  border: '#2A2A2A',
  divider: '#1E1E1E',

  // 태그
  tagBackground: '#2A2A2A',
  tagText: '#C0C0C0',
} as const
```

### `app/constants/regions.ts`
```typescript
export const REGIONS = [
  { id: 'all', label: '전체' },
  { id: '강남', label: '강남' },
  { id: '역삼', label: '역삼' },
  { id: '홍대', label: '홍대' },
  { id: '신촌', label: '신촌' },
  { id: '을지로', label: '을지로' },
  { id: '이태원', label: '이태원' },
  { id: '성수', label: '성수' },
  { id: '잠실', label: '잠실' },
  { id: '수원', label: '수원' },
  { id: '인천', label: '인천' },
  { id: '대전', label: '대전' },
] as const
```

### `app/constants/themes.ts`
```typescript
export const THEMES = [
  { id: '와인', label: '🍷 와인' },
  { id: '커피', label: '☕ 커피' },
  { id: '에세이', label: '📖 에세이' },
  { id: '전시', label: '🎨 전시' },
  { id: '사주', label: '🔮 사주' },
  { id: '보드게임', label: '🎲 보드게임' },
  { id: '쿠킹', label: '👨‍🍳 쿠킹' },
  { id: '일반', label: '💬 일반' },
] as const
```

---

## Supabase 클라이언트

### `app/lib/supabase.ts`
```typescript
import { createClient } from '@supabase/supabase-js'
import Constants from 'expo-constants'
import type { Database } from '@/types/database.types'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)

// 타입 편의 export
export type EventRow = Database['public']['Tables']['events']['Row']
export type CompanyRow = Database['public']['Tables']['companies']['Row']
export type EventWithCompany = EventRow & { companies: CompanyRow }
```

### `app/lib/outlink.ts`
```typescript
import * as WebBrowser from 'expo-web-browser'

export async function openOutlink(url: string): Promise<void> {
  await WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    toolbarColor: '#0F0F0F',
    controlsColor: '#FF6B9D',
    showTitle: true,
  })
}
```

---

## 상태관리

### `app/stores/filterStore.ts`
```typescript
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'

interface FilterState {
  region: string
  dateRange: 'all' | 'today' | 'week' | 'month'
  maxPrice: number | null
  themes: string[]
  sortBy: 'date' | 'deadline' | 'created'
  recentFilters: FilterSnapshot[]   // 최근 5개 저장 (모아뷰 참고)

  setRegion: (region: string) => void
  setDateRange: (range: FilterState['dateRange']) => void
  setMaxPrice: (price: number | null) => void
  toggleTheme: (theme: string) => void
  setSortBy: (sort: FilterState['sortBy']) => void
  saveRecentFilter: () => void
  applyRecentFilter: (snapshot: FilterSnapshot) => void
  resetFilters: () => void
}

interface FilterSnapshot {
  id: string
  region: string
  dateRange: string
  maxPrice: number | null
  themes: string[]
  savedAt: number
}

export const useFilterStore = create<FilterState>()(
  persist(
    (set, get) => ({
      region: 'all',
      dateRange: 'all',
      maxPrice: null,
      themes: [],
      sortBy: 'date',
      recentFilters: [],

      setRegion: (region) => set({ region }),
      setDateRange: (dateRange) => set({ dateRange }),
      setMaxPrice: (maxPrice) => set({ maxPrice }),
      toggleTheme: (theme) => set((s) => ({
        themes: s.themes.includes(theme)
          ? s.themes.filter(t => t !== theme)
          : [...s.themes, theme]
      })),
      setSortBy: (sortBy) => set({ sortBy }),

      saveRecentFilter: () => {
        const { region, dateRange, maxPrice, themes, recentFilters } = get()
        const snapshot: FilterSnapshot = {
          id: Date.now().toString(),
          region, dateRange, maxPrice, themes,
          savedAt: Date.now(),
        }
        const updated = [snapshot, ...recentFilters].slice(0, 5) // 최대 5개
        set({ recentFilters: updated })
      },

      applyRecentFilter: (snapshot) => set({
        region: snapshot.region,
        dateRange: snapshot.dateRange as FilterState['dateRange'],
        maxPrice: snapshot.maxPrice,
        themes: snapshot.themes,
      }),

      resetFilters: () => set({
        region: 'all',
        dateRange: 'all',
        maxPrice: null,
        themes: [],
        sortBy: 'date',
      }),
    }),
    {
      name: 'sodate-filter',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
)
```

---

## 핵심 훅

### `app/hooks/useEvents.ts`
```typescript
import { useState, useEffect, useCallback } from 'react'
import { supabase, type EventWithCompany } from '@/lib/supabase'
import { useFilterStore } from '@/stores/filterStore'

export function useEvents() {
  const [events, setEvents] = useState<EventWithCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { region, dateRange, maxPrice, themes, sortBy } = useFilterStore()

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      let query = supabase
        .from('events')
        .select('*, companies(id, name, logo_url, slug)')
        .eq('is_active', true)
        .eq('is_closed', false)
        .gte('event_date', new Date().toISOString()) // 미래 일정만

      // 지역 필터
      if (region !== 'all') {
        query = query.eq('location_region', region)
      }

      // 날짜 필터
      const now = new Date()
      if (dateRange === 'today') {
        const end = new Date(now); end.setHours(23, 59, 59)
        query = query.lte('event_date', end.toISOString())
      } else if (dateRange === 'week') {
        const end = new Date(now); end.setDate(end.getDate() + 7)
        query = query.lte('event_date', end.toISOString())
      } else if (dateRange === 'month') {
        const end = new Date(now); end.setMonth(end.getMonth() + 1)
        query = query.lte('event_date', end.toISOString())
      }

      // 가격 필터
      if (maxPrice) {
        query = query.or(`price_male.lte.${maxPrice},price_female.lte.${maxPrice}`)
      }

      // 테마 필터
      if (themes.length > 0) {
        query = query.overlaps('theme', themes)
      }

      // 정렬
      if (sortBy === 'deadline') {
        query = query.order('event_date', { ascending: true })
      } else if (sortBy === 'created') {
        query = query.order('created_at', { ascending: false })
      } else {
        query = query.order('event_date', { ascending: true })
      }

      const { data, error: err } = await query.limit(100)
      if (err) throw err
      setEvents(data as EventWithCompany[])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [region, dateRange, maxPrice, themes, sortBy])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  return { events, loading, error, refetch: fetchEvents }
}
```

---

## 핵심 컴포넌트

### `app/components/EventCard.tsx`
```typescript
import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native'
import { Image } from 'expo-image'
import { openOutlink } from '@/lib/outlink'
import { Colors } from '@/constants/colors'
import type { EventWithCompany } from '@/lib/supabase'
import DeadlineBadge from './DeadlineBadge'
import ThemeTag from './ThemeTag'

const { width } = Dimensions.get('window')

interface Props {
  event: EventWithCompany
}

export default function EventCard({ event }: Props) {
  const handlePress = () => openOutlink(event.source_url)

  const daysLeft = Math.ceil(
    (new Date(event.event_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  )

  return (
    <TouchableOpacity style={styles.card} onPress={handlePress} activeOpacity={0.85}>
      {/* 썸네일 */}
      <View style={styles.imageContainer}>
        {event.thumbnail_urls?.[0] ? (
          <Image
            source={{ uri: event.thumbnail_urls[0] }}
            style={styles.image}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={styles.imagePlaceholder} />
        )}
        {daysLeft <= 3 && daysLeft > 0 && (
          <DeadlineBadge daysLeft={daysLeft} />
        )}
      </View>

      {/* 카드 내용 */}
      <View style={styles.content}>
        {/* 업체명 */}
        <Text style={styles.company}>{event.companies?.name}</Text>

        {/* 제목 */}
        <Text style={styles.title} numberOfLines={2}>{event.title}</Text>

        {/* 날짜 + 지역 */}
        <View style={styles.metaRow}>
          <Text style={styles.meta}>
            📅 {formatDate(event.event_date)}
          </Text>
          <Text style={styles.meta}>📍 {event.location_region}</Text>
        </View>

        {/* 성비 + 가격 */}
        <View style={styles.metaRow}>
          {event.gender_ratio && (
            <Text style={styles.meta}>👫 {event.gender_ratio}</Text>
          )}
          {event.price_male && (
            <Text style={styles.price}>
              남 {event.price_male.toLocaleString()}원
            </Text>
          )}
          {event.price_female && (
            <Text style={styles.price}>
              여 {event.price_female.toLocaleString()}원
            </Text>
          )}
        </View>

        {/* 테마 태그 */}
        {event.theme && event.theme.length > 0 && (
          <View style={styles.tags}>
            {event.theme.slice(0, 3).map(t => (
              <ThemeTag key={t} label={t} />
            ))}
          </View>
        )}

        {/* 신청 버튼 */}
        <TouchableOpacity style={styles.cta} onPress={handlePress}>
          <Text style={styles.ctaText}>신청하기 →</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  )
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]}) ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    overflow: 'hidden',
  },
  imageContainer: { position: 'relative' },
  image: { width: '100%', height: 200 },
  imagePlaceholder: { width: '100%', height: 200, backgroundColor: Colors.surfaceHigh },
  content: { padding: 16 },
  company: { fontSize: 12, color: Colors.primary, fontWeight: '600', marginBottom: 4 },
  title: { fontSize: 16, color: Colors.textPrimary, fontWeight: '700', marginBottom: 8, lineHeight: 22 },
  metaRow: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  meta: { fontSize: 13, color: Colors.textSecondary },
  price: { fontSize: 13, color: Colors.textSecondary },
  tags: { flexDirection: 'row', gap: 6, marginTop: 8 },
  cta: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 14 },
})
```

---

## 화면 구조

### `app/app/_layout.tsx`
```typescript
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { Colors } from '@/constants/colors'

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.textPrimary,
          contentStyle: { backgroundColor: Colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: '소개팅모아', headerLargeTitle: true }} />
        <Stack.Screen name="event/[id]" options={{ title: '소개팅 상세' }} />
        <Stack.Screen name="company/[id]" options={{ title: '업체 정보' }} />
        <Stack.Screen name="alerts" options={{ title: '알림 설정' }} />
        <Stack.Screen name="settings" options={{ title: '설정' }} />
      </Stack>
    </>
  )
}
```

### `app/app/index.tsx` (홈 피드 - 핵심 화면)
```typescript
import { FlashList } from '@shopify/flash-list'
import { View, Text, RefreshControl } from 'react-native'
import EventCard from '@/components/EventCard'
import EventCardSkeleton from '@/components/EventCardSkeleton'
import FilterSheet from '@/components/FilterSheet'
import { useEvents } from '@/hooks/useEvents'
import { Colors } from '@/constants/colors'

export default function HomeScreen() {
  const { events, loading, error, refetch } = useEvents()
  const [filterVisible, setFilterVisible] = useState(false)

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      {[1,2,3].map(i => <EventCardSkeleton key={i} />)}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* 필터 바 */}
      <FilterBar onOpenFilter={() => setFilterVisible(true)} />

      {/* 이벤트 리스트 */}
      <FlashList
        data={events}
        renderItem={({ item }) => <EventCard event={item} />}
        estimatedItemSize={380}
        keyExtractor={item => item.id}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refetch}
            tintColor={Colors.primary} />
        }
        ListEmptyComponent={<EmptyState />}
        contentContainerStyle={{ paddingVertical: 8 }}
      />

      <FilterSheet visible={filterVisible} onClose={() => setFilterVisible(false)} />
    </View>
  )
}
```

---

## ✅ 완료 기준 (DoD)
- [ ] 모든 화면 에러 없이 렌더링
- [ ] Supabase events 데이터 카드로 표시
- [ ] 필터 (지역/날짜/가격/테마) 동작
- [ ] 최근 필터 5개 저장/복원 동작
- [ ] [신청하기] 아웃링크 인앱 브라우저로 열림
- [ ] iOS Simulator + Android Emulator 모두 정상 실행
- [ ] TypeScript 에러 0개

## ⛔ 절대 금지
- 자체 결제/예약 UI 구현 금지
- 회원가입/로그인 화면 구현 금지
- `any` 타입 남발 금지 (database.types.ts 적극 활용)
- 하드코딩 컬러값 사용 금지 (colors.ts 사용)
