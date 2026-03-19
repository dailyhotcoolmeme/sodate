import { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  StatusBar,
} from 'react-native'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Colors } from '@/constants/colors'

const { width, height } = Dimensions.get('window')
const ONBOARDING_KEY = 'sodate-onboarding-done'

const SLIDES = [
  {
    emoji: '💑',
    title: '소개팅모아',
    subtitle: '전국 로테이션 소개팅 일정을\n한곳에서 모아보세요',
  },
  {
    emoji: '🔍',
    title: '쉽게 찾고',
    subtitle: '지역·테마·가격으로 필터링해\n나에게 딱 맞는 소개팅을 찾아보세요',
  },
  {
    emoji: '🔔',
    title: '빠르게 알림받고',
    subtitle: '관심 업체의 새 일정이 올라오면\n제일 먼저 알려드려요',
  },
  {
    emoji: '🚀',
    title: '바로 신청',
    subtitle: '마음에 드는 소개팅을 찾았다면\n한 번의 터치로 신청 페이지로 이동',
  },
]

export default function OnboardingScreen() {
  const [step, setStep] = useState(0)
  const router = useRouter()

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
  }

  const slide = SLIDES[step]

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* 건너뛰기 */}
      {!isLast && (
        <TouchableOpacity style={styles.skipBtn} onPress={handleFinish}>
          <Text style={styles.skipText}>건너뛰기</Text>
        </TouchableOpacity>
      )}

      {/* 슬라이드 내용 */}
      <View style={styles.slideContent}>
        <Text style={styles.emoji}>{slide.emoji}</Text>
        <Text style={styles.title}>{slide.title}</Text>
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
      <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
        <Text style={styles.nextBtnText}>
          {isLast ? '시작하기' : '다음'}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
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
    color: Colors.textTertiary,
    fontSize: 14,
  },
  slideContent: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 80,
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 16,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textSecondary,
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
    backgroundColor: Colors.border,
  },
  dotActive: {
    backgroundColor: Colors.primary,
    width: 24,
  },
  nextBtn: {
    width: width - 64,
    backgroundColor: Colors.primary,
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
})
