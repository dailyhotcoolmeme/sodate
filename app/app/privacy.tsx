import React, { useMemo } from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '@/hooks/useColors'

export default function PrivacyScreen() {
  const insets = useSafeAreaInsets()
  const colors = useColors()
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20, paddingBottom: 60 },
    title: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, marginBottom: 8 },
    date: { fontSize: 12, color: colors.textTertiary, marginBottom: 28 },
    sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginTop: 24, marginBottom: 8 },
    body: { fontSize: 14, color: colors.textSecondary, lineHeight: 22 },
    bullet: { fontSize: 14, color: colors.textSecondary, lineHeight: 22, marginLeft: 8 },
  }), [colors])

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text style={styles.title}>개인정보처리방침</Text>
        <Text style={styles.date}>시행일: 2025년 1월 1일 | 최종 수정일: 2026년 3월 20일</Text>

        <Text style={styles.body}>
          소개팅모아(이하 "서비스")는 이용자의 개인정보를 중요하게 생각하며, 「개인정보 보호법」을 준수합니다. 본 방침을 통해 수집하는 개인정보의 항목, 이용 목적, 보유 기간 등을 안내드립니다.
        </Text>

        <Text style={styles.sectionTitle}>1. 수집하는 개인정보 항목</Text>
        <Text style={styles.bullet}>
          • 기기 고유 식별자(푸시 알림 토큰){'\n'}
          • 앱 이용 기록(알림 설정 정보: 관심 지역, 관심 테마, 알림 수신 여부){'\n'}
          • 자동 수집 항목: 기기 모델, OS 버전, 앱 버전
        </Text>
        <Text style={styles.body}>
          서비스는 회원가입을 요구하지 않으며, 이름·연락처·이메일 등 개인 식별 정보를 수집하지 않습니다.
        </Text>

        <Text style={styles.sectionTitle}>2. 개인정보 수집 및 이용 목적</Text>
        <Text style={styles.bullet}>
          • 푸시 알림 발송: 관심 지역·테마에 맞는 새 소개팅 일정 및 마감 알림{'\n'}
          • 서비스 품질 개선: 앱 오류 분석 및 기능 개선
        </Text>

        <Text style={styles.sectionTitle}>3. 개인정보 보유 및 이용 기간</Text>
        <Text style={styles.body}>
          수집된 정보는 수집 시점부터 앱 삭제 또는 이용자의 삭제 요청 시까지 보유합니다. 다만, 관계 법령에 따라 보존이 필요한 경우 해당 기간 동안 보유합니다.
        </Text>

        <Text style={styles.sectionTitle}>4. 개인정보의 제3자 제공</Text>
        <Text style={styles.body}>
          서비스는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 다만, 법령에 의하거나 수사기관의 요청이 있는 경우는 예외입니다.
        </Text>

        <Text style={styles.sectionTitle}>5. 개인정보 처리 위탁</Text>
        <Text style={styles.bullet}>
          • Supabase Inc.: 데이터 저장 및 서버 운영 (미국 서버 이용){'\n'}
          • Expo (Expo Inc.): 푸시 알림 발송 서비스
        </Text>

        <Text style={styles.sectionTitle}>6. 이용자의 권리</Text>
        <Text style={styles.body}>
          이용자는 언제든지 자신의 개인정보에 대한 열람, 정정, 삭제, 처리 정지를 요청할 수 있습니다. 요청은 아래 문의처로 연락 주시면 지체 없이 처리하겠습니다.
        </Text>

        <Text style={styles.sectionTitle}>7. 쿠키 및 추적 기술</Text>
        <Text style={styles.body}>
          서비스는 별도의 쿠키를 사용하지 않습니다. 다만 앱 내 AsyncStorage를 통해 알림 설정, 테마 설정, 관심 목록 등을 기기 내에 저장합니다. 이는 이용자 기기 외부로 전송되지 않습니다.
        </Text>

        <Text style={styles.sectionTitle}>8. 개인정보 보호책임자</Text>
        <Text style={styles.body}>
          개인정보 처리에 관한 불만·문의는 아래로 연락 주세요.{'\n\n'}
          이메일: ourmine0319@gmail.com{'\n'}
          처리 기간: 접수 후 7일 이내
        </Text>

        <Text style={styles.sectionTitle}>9. 방침 변경 안내</Text>
        <Text style={styles.body}>
          본 방침이 변경될 경우 앱 내 공지를 통해 최소 7일 전에 안내합니다.
        </Text>
      </ScrollView>
    </View>
  )
}
