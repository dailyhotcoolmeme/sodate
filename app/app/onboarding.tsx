import React, { useState, useMemo } from 'react'
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  StatusBar,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useColors } from '@/hooks/useColors'
import { runPostOnboardingSetup } from '@/lib/initAds'

const { width } = Dimensions.get('window')
const ONBOARDING_KEY = 'sodate-onboarding-done'

// 첫 슬라이드는 아이콘+제목 대신 브랜드 워드마크 이미지(하트+글자)를 쓴다.
const SLIDES: { icon: keyof typeof Ionicons.glyphMap; color: string; title: string; subtitle: string; logo?: boolean }[] = [
  {
    icon: 'heart',
    color: '#FF6B9D',
    title: '소개팅모아',
    logo: true,
    subtitle: '전국 로테이션 소개팅 일정을\n한곳에서 모아보세요',
  },
  {
    icon: 'search',
    color: '#A78BFA',
    title: '쉽게 찾고',
    subtitle: '지역·테마·가격으로 필터링해\n나에게 딱 맞는 소개팅을 찾아보세요',
  },
  {
    icon: 'notifications',
    color: '#FB923C',
    title: '빠르게 알림받고',
    subtitle: '관심 업체의 새 일정이 올라오면\n제일 먼저 알려드려요',
  },
  {
    icon: 'arrow-forward-circle',
    color: '#34D399',
    title: '바로 신청',
    subtitle: '마음에 드는 소개팅을 찾았다면\n한 번의 터치로 신청 페이지로 이동',
  },
]

export default function OnboardingScreen() {
  const [step, setStep] = useState(0)
  const router = useRouter()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
    skipBtn: {
      position: 'absolute',
      top: 56,
      right: 24,
    },
    skipText: {
      color: colors.textTertiary,
      fontSize: 14,
    },
    slideContent: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
    },
    brandLogo: {
      width: 200,
      height: 200 * (644 / 821),
      marginBottom: 32,
    },
    iconCircle: {
      width: 120,
      height: 120,
      borderRadius: 60,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 40,
    },
    title: {
      fontSize: 28,
      fontWeight: '800',
      color: colors.textPrimary,
      marginBottom: 16,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 16,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 24,
    },
    dots: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 32,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.border,
    },
    dotActive: {
      backgroundColor: colors.primary,
      width: 24,
    },
    nextBtn: {
      width: width - 64,
      backgroundColor: colors.primary,
      borderRadius: 14,
      paddingVertical: 16,
      alignItems: 'center',
      marginBottom: 48,
    },
    nextBtnText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
  }), [colors])

  const isLast = step === SLIDES.length - 1

  const handleNext = () => {
    if (isLast) {
      handleFinish()
    } else {
      setStep((s) => s + 1)
    }
  }

  const handleFinish = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true')
    router.replace('/')
    // 시스템 권한 팝업(알림 → 추적)은 여기서 처음 뜬다. 앱을 켜자마자 아무 맥락 없이
    // 물으면 대부분 거부하고, 알림을 거부하면 이 앱의 핵심인 새 일정·마감 알림을
    // 영영 못 보낸다. 온보딩으로 앱이 뭔지 본 다음에 묻는다.
    // await 하지 않아 화면 전환은 안 막는다.
    runPostOnboardingSetup()
  }

  const slide = SLIDES[step]

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* 건너뛰기 */}
      {!isLast && (
        <TouchableOpacity style={[styles.skipBtn, { top: insets.top + 12 }]} onPress={handleFinish}>
          <Text style={styles.skipText}>건너뛰기</Text>
        </TouchableOpacity>
      )}

      {/* 슬라이드 내용 */}
      <View style={styles.slideContent}>
        {slide.logo ? (
          <Image
            source={require('../assets/logo-stack.png')}
            style={styles.brandLogo}
            resizeMode="contain"
            accessibilityLabel={slide.title}
          />
        ) : (
          <>
            <View style={[styles.iconCircle, { backgroundColor: slide.color + '22' }]}>
              <Ionicons name={slide.icon} size={60} color={slide.color} />
            </View>
            <Text style={styles.title}>{slide.title}</Text>
          </>
        )}
        <Text style={styles.subtitle}>{slide.subtitle}</Text>
      </View>

      {/* 도트 인디케이터 */}
      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === step && styles.dotActive]}
          />
        ))}
      </View>

      {/* 버튼 */}
      <TouchableOpacity style={[styles.nextBtn, { marginBottom: insets.bottom + 24 }]} onPress={handleNext}>
        <Text style={styles.nextBtnText}>
          {isLast ? '시작하기' : '다음'}
        </Text>
      </TouchableOpacity>
    </View>
  )
}
