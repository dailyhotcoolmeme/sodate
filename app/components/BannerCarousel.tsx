import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Dimensions,
  ScrollView,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useFocusEffect } from 'expo-router'
import { useColors } from '@/hooks/useColors'
import { supabase } from '@/lib/supabase'
import { track } from '@/lib/analytics'

/**
 * 메뉴 상단 배너(2026-09-02 오너 지시). 소개팅·소셜링·혼술바·커뮤니티가 각각 독립이다.
 *
 * ## 데이터
 * `active_banners` 뷰 하나만 본다 — 메뉴 스위치·배너 스위치·노출 기간을 **서버에서** 이미
 * 걸러 준다. 앱이 날짜를 계산하면 기기 표준시(해외 사용자)에 따라 하루가 밀린다.
 *
 * ## 자동 넘김에서 챙긴 것
 * - **화면을 벗어나면 타이머를 멈춘다.** 안 그러면 안 보는 탭이 5초마다 계속 리렌더된다.
 * - **손으로 넘기면 타이머를 리셋한다.** 안 그러면 넘긴 직후 바로 또 넘어가 버린다.
 * - 1장이면 자동 넘김도 점도 없다. 0장이면 아무것도 안 그린다(빈 공간도 없다).
 *
 * ## 고정(sticky)이 아니다
 * 리스트의 헤더로 들어가 스크롤하면 같이 올라간다. 상단에 붙박이로 두면 배너가 화면을
 * 영구히 먹는다.
 */

export type BannerMenu = 'dating' | 'socialing' | 'honsul' | 'board'

interface BannerRow {
  id: string
  menu: BannerMenu
  image_url: string
  target_type: 'url' | 'event' | 'company' | 'place' | 'none'
  target_value: string | null
  sort_order: number
}

// 게시글 행·카드와 같은 좌우 여백.
const SIDE = 16
// 배너 원본 1110×276 = 4:1 (2026-08-19 오너가 고른 비율).
const ASPECT = 1110 / 276
const AUTO_MS = 5000

export default function BannerCarousel({ menu }: { menu: BannerMenu }) {
  const colors = useColors()
  const router = useRouter()
  const [banners, setBanners] = useState<BannerRow[]>([])
  const [index, setIndex] = useState(0)
  const scrollRef = useRef<ScrollView>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const focusedRef = useRef(true)

  const width = Dimensions.get('window').width - SIDE * 2
  const height = width / ASPECT

  useEffect(() => {
    let alive = true
    supabase
      .from('active_banners')
      .select('id,menu,image_url,target_type,target_value,sort_order')
      .eq('menu', menu)
      .then(({ data }) => {
        if (alive && data) setBanners(data as any)
      })
    return () => { alive = false }
  }, [menu])

  const count = banners.length

  const goTo = useCallback((next: number) => {
    if (count < 2) return
    const i = ((next % count) + count) % count
    scrollRef.current?.scrollTo({ x: i * width, animated: true })
    setIndex(i)
  }, [count, width])

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (count < 2) return
    timerRef.current = setInterval(() => {
      if (!focusedRef.current) return
      setIndex((cur) => {
        const next = (cur + 1) % count
        scrollRef.current?.scrollTo({ x: next * width, animated: true })
        return next
      })
    }, AUTO_MS)
  }, [count, width])

  useEffect(() => {
    startTimer()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [startTimer])

  // 다른 탭으로 나가면 멈추고 돌아오면 다시 돈다.
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true
      return () => { focusedRef.current = false }
    }, [])
  )

  // 보이는 장이 바뀔 때마다 노출 1회. "몇 번 떴나"가 아니라 "몇 번 눈에 보였나"를 센다.
  const seenRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const b = banners[index]
    if (!b || seenRef.current.has(b.id)) return
    seenRef.current.add(b.id)
    track('banner_impression', { properties: { banner_id: b.id, menu } })
  }, [index, banners, menu])

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width)
    setIndex(i)
    startTimer()   // 손으로 넘겼으면 5초를 처음부터 다시 센다
  }

  const open = (b: BannerRow) => {
    track('banner_click', { properties: { banner_id: b.id, menu, target: b.target_type } })
    const v = b.target_value
    if (!v) return
    switch (b.target_type) {
      case 'url': Linking.openURL(v).catch(() => {}); break
      case 'event': router.push(`/event/${v}`); break
      case 'company': router.push(`/company/${v}`); break
      case 'place': router.push(`/place/${v}`); break
      default: break
    }
  }

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: { paddingHorizontal: SIDE, paddingTop: 10, paddingBottom: 4 },
        page: { width, height, borderRadius: 12, overflow: 'hidden' },
        image: { width: '100%', height: '100%' },
        dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 },
        dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
        dotOn: { backgroundColor: colors.primary, width: 16 },
      }),
    [colors, width, height]
  )

  if (count === 0) return null

  // 1장이면 스크롤뷰도 점도 필요 없다.
  if (count === 1) {
    const b = banners[0]
    return (
      <View style={styles.wrap}>
        <TouchableOpacity
          style={styles.page}
          activeOpacity={b.target_type === 'none' ? 1 : 0.9}
          disabled={b.target_type === 'none'}
          onPress={() => open(b)}
        >
          <Image source={{ uri: b.image_url }} style={styles.image} contentFit="cover" transition={200} />
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.wrap}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        // 손을 대는 순간 자동 넘김이 끼어들지 않게(스크롤 중 scrollTo 가 겹치면 튄다)
        onScrollBeginDrag={() => { if (timerRef.current) clearInterval(timerRef.current) }}
      >
        {banners.map((b) => (
          <TouchableOpacity
            key={b.id}
            style={styles.page}
            activeOpacity={b.target_type === 'none' ? 1 : 0.9}
            disabled={b.target_type === 'none'}
            onPress={() => open(b)}
          >
            <Image source={{ uri: b.image_url }} style={styles.image} contentFit="cover" transition={200} />
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={styles.dots}>
        {banners.map((b, i) => (
          <View key={b.id} style={[styles.dot, i === index && styles.dotOn]} />
        ))}
      </View>
    </View>
  )
}
