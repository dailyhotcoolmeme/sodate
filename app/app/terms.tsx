import React, { useMemo } from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '@/hooks/useColors'

export default function TermsScreen() {
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
        <Text style={styles.title}>이용약관</Text>
        <Text style={styles.date}>시행일: 2026년 3월 20일 | 최종 수정일: 2026년 3월 20일</Text>

        <Text style={styles.sectionTitle}>제1조 (목적)</Text>
        <Text style={styles.body}>
          본 약관은 소개팅모아(이하 "서비스")가 제공하는 모바일 앱 서비스의 이용 조건 및 절차, 회사와 이용자 간의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.
        </Text>

        <Text style={styles.sectionTitle}>제2조 (서비스 정의)</Text>
        <Text style={styles.body}>
          서비스는 전국 로테이션 소개팅 업체의 공개된 일정 정보를 수집·정리하여 이용자에게 제공하는 정보 중개 플랫폼입니다. 서비스는 직접 소개팅을 운영하거나 주최하지 않으며, 각 업체의 신청 페이지로 연결하는 아웃링크만을 제공합니다.
        </Text>

        <Text style={styles.sectionTitle}>제3조 (서비스 이용)</Text>
        <Text style={styles.bullet}>
          • 본 서비스는 별도의 회원가입 없이 이용할 수 있습니다.{'\n'}
          • 이용자는 만 14세 이상이어야 합니다.{'\n'}
          • 서비스는 iOS 및 Android 기기에서 무료로 이용할 수 있습니다.{'\n'}
          • 일부 기능(푸시 알림)은 기기 알림 권한 허용 시 이용 가능합니다.
        </Text>

        <Text style={styles.sectionTitle}>제4조 (서비스의 변경 및 중단)</Text>
        <Text style={styles.body}>
          서비스는 운영상 또는 기술상의 이유로 서비스 내용을 변경하거나 일시 중단할 수 있습니다. 서비스 중단 시 사전 공지를 원칙으로 하나, 긴급한 경우 사후 공지할 수 있습니다.
        </Text>

        <Text style={styles.sectionTitle}>제5조 (정보의 정확성)</Text>
        <Text style={styles.body}>
          서비스에서 제공하는 소개팅 일정, 가격, 장소 등의 정보는 각 업체의 공개 정보를 자동으로 수집한 것으로, 실제 정보와 다를 수 있습니다. 이용자는 신청 전 반드시 각 업체의 공식 페이지에서 최신 정보를 확인하시기 바랍니다. 서비스는 정보의 정확성에 대해 보증하지 않으며, 이로 인한 손해에 대해 책임지지 않습니다.
        </Text>

        <Text style={styles.sectionTitle}>제6조 (이용자 금지 행위)</Text>
        <Text style={styles.bullet}>
          • 서비스의 정상적인 운영을 방해하는 행위{'\n'}
          • 서비스 내 정보를 무단으로 수집·복제·배포하는 행위{'\n'}
          • 타인의 정보를 도용하거나 허위 정보를 입력하는 행위{'\n'}
          • 관련 법령을 위반하는 일체의 행위
        </Text>

        <Text style={styles.sectionTitle}>제7조 (책임 한계)</Text>
        <Text style={styles.body}>
          서비스는 이용자와 소개팅 업체 간의 거래에 개입하지 않으며, 업체와의 분쟁, 환불, 불만 사항에 대해 책임지지 않습니다. 소개팅 신청, 결제, 참가는 전적으로 해당 업체와 이용자 간의 계약 관계입니다.
        </Text>

        <Text style={styles.sectionTitle}>제8조 (지적재산권)</Text>
        <Text style={styles.body}>
          서비스가 직접 제작한 앱 디자인, 소스코드, 텍스트 등의 저작권은 서비스 운영자에게 있습니다. 각 업체의 이미지, 텍스트 등의 저작권은 해당 업체에 있습니다.
        </Text>

        <Text style={styles.sectionTitle}>제9조 (준거법 및 관할)</Text>
        <Text style={styles.body}>
          본 약관은 대한민국 법령에 따라 해석되며, 서비스와 이용자 간 분쟁이 발생할 경우 서울중앙지방법원을 전속 관할 법원으로 합니다.
        </Text>

        <Text style={styles.sectionTitle}>제10조 (문의)</Text>
        <Text style={styles.body}>
          이용약관에 관한 문의사항은 아래로 연락 주세요.{'\n\n'}
          이메일: ourmine0319@gmail.com
        </Text>
      </ScrollView>
    </View>
  )
}
