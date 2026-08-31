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
// ⚠️ 2026-08-31 개편: 예전엔 4장 전부 소개팅 얘기라, 처음 켠 사람은 소셜링·혼술바·
//    커뮤니티가 있는 줄도 몰랐다. 이제 1장=브랜드, 2~5장=서비스 하나씩 소개한다.
//    (구성·문구는 오너 확정)
const SLIDES: { icon: keyof typeof Ionicons.glyphMap; color: string; title: string; subtitle: string; logo?: boolean }[] = [
  {
    icon: 'heart',
    color: '#FF6B9D',
    title: '모잇',
    logo: true,
    subtitle: '새로운 사람을 만나는 모든 방법',
  },
  {
    icon: 'heart-circle',
    color: '#FF6B9D',
    title: '소개팅',
    subtitle: '전국 로테이션 소개팅 일정을 한곳에서\n지역·나이·가격으로 골라 보고 바로 신청까지',
  },
  {
    icon: 'people',
    color: '#A78BFA',
    title: '소셜링',
    subtitle: '취미와 관심사로 모이는 사람들\n독서·러닝·보드게임… 마음 맞는 자리를 찾아보세요',
  },
  {
    icon: 'wine',
    color: '#FB923C',
    title: '혼술바',
    subtitle: '혼자 마시기 좋은 술집을 지도에서\n분위기·안주·가격까지 미리 보고 가세요',
  },
  {
    icon: 'chatbubbles',
    color: '#34D399',
    title: '커뮤니티',
    subtitle: '같은 또래끼리 이야기 나누어요',
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
    // ⚠️ 예전엔 justifyContent:'center' 라 장마다 줄 수가 다르면 아이콘·제목이 위아래로
    //    흔들렸다(5장은 부제가 한 줄이라 유독 위로 올라갔다). 위에서부터 고정 간격으로
    //    두어 다섯 장의 아이콘·제목·부제가 같은 높이에 오게 한다.
    slideContent: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'flex-start',
      paddingTop: 200,
    },
    brandLogo: {
      // 하트 크기를 예전과 같게 두려고 높이를 기준으로 잡는다(이름이 짧아져 폭만 줄었다).
      width: 200 * (429 / 821),
      height: 200 * (698 / 821),
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
      minHeight: 48,          // 두 줄 자리 고정(장마다 높이가 달라지지 않게)
    },
    // 1장은 제목이 따로 없다(로고 이미지에 '모잇'이 들어 있다). 그래서 부제를 조금 키워
    // 브랜드 문구처럼 읽히게 한다 — 다른 장의 제목 자리를 대신하는 셈.
    tagline: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.textPrimary,
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
        <Text style={[styles.subtitle, slide.logo && styles.tagline]}>{slide.subtitle}</Text>
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
