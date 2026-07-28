import React, { useMemo } from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '@/hooks/useColors'
import TopBar from '@/components/TopBar'

export default function PrivacyScreen() {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20 },
    title: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, marginBottom: 8 },
    date: { fontSize: 12, color: colors.textTertiary, marginBottom: 28 },
    sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginTop: 24, marginBottom: 8 },
    body: { fontSize: 14, color: colors.textSecondary, lineHeight: 22 },
    bullet: { fontSize: 14, color: colors.textSecondary, lineHeight: 22, marginLeft: 8 },
  }), [colors])

  return (
    <View style={styles.container}>
      <TopBar showBack />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
        <Text style={styles.title}>개인정보처리방침</Text>
        <Text style={styles.date}>시행일: 2026년 7월 20일</Text>

        <Text style={styles.body}>
          소개팅모아(이하 "서비스")는 이용자의 개인정보를 중요하게 생각하며, 「개인정보 보호법」을 준수합니다. 본 방침을 통해 수집하는 개인정보의 항목, 이용 목적, 보유 기간 등을 안내드립니다.
        </Text>

        <Text style={styles.sectionTitle}>1. 수집하는 개인정보 항목</Text>
        <Text style={styles.bullet}>
          • 기기 고유 식별자(푸시 알림 토큰){'\n'}
          • 앱 이용 기록(알림 설정 정보: 관심 지역, 관심 테마, 알림 수신 여부){'\n'}
          • 이용자가 후기를 작성하는 경우: 닉네임, 후기 내용, 별점, 후기 관리(수정·삭제)용 익명 식별 토큰{'\n'}
          • 광고 식별자(모바일 광고 ID / Apple IDFA): 맞춤형 광고 제공을 위해 광고 서비스(Google AdMob)를 통해 수집·이용{'\n'}
          • 이용자가 '내 정보'에 직접 입력하는 경우: 나이, 성별{'\n'}
          • 자동 수집 항목: 기기 모델, OS 버전, 앱 버전
        </Text>
        <Text style={styles.body}>
          서비스는 회원가입을 요구하지 않으며, 실명·연락처·이메일 등은 수집하지 않습니다. 후기 작성 시 입력하는 닉네임은 실명이 아니어도 되며, 후기 관리용 식별 토큰은 본인이 작성한 후기의 수정·삭제 권한 확인에만 사용됩니다.{'\n\n'}
          '내 정보'의 나이·성별은 입력을 원하는 경우에만 받으며, 기기 내 저장소에 보관되고 조건에 맞는 일정을 찾기 위한 검색 조건으로만 서버에 전송됩니다. 서버에 별도로 저장되지 않으며, 언제든 앱에서 지우거나 바꿀 수 있습니다.
        </Text>

        <Text style={styles.sectionTitle}>2. 개인정보 수집 및 이용 목적</Text>
        <Text style={styles.bullet}>
          • 푸시 알림 발송: 관심 지역·테마에 맞는 새 소개팅 일정 및 마감 알림{'\n'}
          • 맞춤 일정 검색: 입력한 나이·성별 조건에 맞는 일정만 골라 보여주기{'\n'}
          • 이용자 후기 게시 및 관리(수정·삭제·신고 처리, 부적절 게시물 차단){'\n'}
          • 광고 게재: 서비스 운영을 위한 광고(맞춤형 광고 포함) 노출 및 성과 측정{'\n'}
          • 서비스 품질 개선: 앱 오류 분석 및 기능 개선
        </Text>

        <Text style={styles.sectionTitle}>3. 개인정보 보유 기간 및 파기 절차·방법</Text>
        <Text style={styles.body}>
          수집된 정보는 수집 시점부터 앱 삭제 또는 이용자의 삭제 요청 시까지 보유합니다. 다만, 관계 법령에 따라 보존이 필요한 경우 해당 기간 동안 보유합니다.{'\n\n'}
          보유 기간이 지나거나 처리 목적이 달성된 개인정보는 지체 없이 파기합니다. 서비스가 보유하는 개인정보는 모두 전자적 파일 형태이며, 복구·재생이 불가능한 방법으로 영구 삭제합니다. 기기 내 저장소에 보관된 정보는 이용자가 앱을 삭제하면 함께 삭제됩니다.
        </Text>

        <Text style={styles.sectionTitle}>4. 개인정보의 제3자 제공</Text>
        <Text style={styles.body}>
          서비스는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 다만, 법령에 의하거나 수사기관의 요청이 있는 경우는 예외입니다.
        </Text>

        <Text style={styles.sectionTitle}>5. 개인정보 처리 위탁</Text>
        <Text style={styles.bullet}>
          • Supabase Inc.: 데이터 저장 및 서버 운영 (미국 서버 이용){'\n'}
          • Expo (Expo Inc.): 푸시 알림 발송 서비스{'\n'}
          • Google LLC (Google AdMob): 광고 게재 및 광고 성과 측정
        </Text>

        <Text style={styles.sectionTitle}>6. 개인정보의 국외 이전</Text>
        <Text style={styles.body}>
          서비스는 아래와 같이 개인정보를 국외로 이전하여 처리합니다. 이용자는 국외 이전을 거부할 수 있으나, 거부 시 서비스 이용이 제한될 수 있습니다.
        </Text>
        <Text style={styles.bullet}>
          {'\n'}• 이전받는 자: Supabase Inc. (문의: privacy@supabase.io){'\n'}
            이전 국가: 미국 / 이전 항목: 기기 식별자, 앱 이용 기록, 후기 정보{'\n'}
            이전 일시·방법: 서비스 이용 시점에 네트워크를 통해 전송{'\n'}
            이용 목적: 데이터 저장 및 서버 운영 / 보유 기간: 위 3항과 동일{'\n\n'}
          • 이전받는 자: Expo Inc.{'\n'}
            이전 국가: 미국 / 이전 항목: 푸시 알림 토큰{'\n'}
            이전 일시·방법: 알림 발송 시점에 네트워크를 통해 전송{'\n'}
            이용 목적: 푸시 알림 발송 / 보유 기간: 위 3항과 동일{'\n\n'}
          • 이전받는 자: Google LLC{'\n'}
            이전 국가: 미국 / 이전 항목: 광고 식별자{'\n'}
            이전 일시·방법: 광고 노출 시점에 SDK를 통해 전송{'\n'}
            이용 목적: 광고 게재 및 성과 측정 / 보유 기간: Google 정책에 따름
        </Text>

        <Text style={styles.sectionTitle}>7. 이용자의 권리</Text>
        <Text style={styles.body}>
          이용자는 언제든지 자신의 개인정보에 대한 열람, 정정, 삭제, 처리 정지를 요청할 수 있습니다. 요청은 아래 문의처로 연락 주시면 지체 없이 처리하겠습니다.
        </Text>

        <Text style={styles.sectionTitle}>8. 광고 및 추적 기술</Text>
        <Text style={styles.body}>
          서비스는 별도의 쿠키를 사용하지 않으며, 앱 내 설정·테마·관심 목록 등은 기기 내 저장소(AsyncStorage)에만 저장되어 외부로 전송되지 않습니다.{'\n\n'}
          서비스는 Google AdMob을 통해 광고를 게재하며, 이 과정에서 기기의 광고 식별자(광고 ID / IDFA)가 맞춤형 광고 제공 및 성과 측정에 이용될 수 있습니다. 이용자는 다음 방법으로 맞춤형 광고를 거부(옵트아웃)할 수 있습니다.{'\n'}
          • iOS: 설정 › 개인정보 보호 및 보안 › 추적 에서 앱의 추적 허용을 끄면 맞춤형 광고가 제공되지 않습니다.{'\n'}
          • Android: 설정 › Google › 광고 에서 '광고 개인 최적화 삭제' 또는 광고 ID 재설정.{'\n\n'}
          맞춤형 광고를 거부하더라도 광고 자체는 노출되며, 개인화되지 않은 광고로 대체됩니다.
        </Text>

        <Text style={styles.sectionTitle}>9. 개인정보의 안전성 확보 조치</Text>
        <Text style={styles.body}>
          서비스는 개인정보의 안전한 처리를 위해 다음과 같은 조치를 하고 있습니다.
        </Text>
        <Text style={styles.bullet}>
          • 개인정보에 접근할 수 있는 인원을 최소한으로 제한하고, 접근 권한을 차등 부여{'\n'}
          • 데이터베이스에 행 단위 접근 통제(RLS)를 적용해 이용자별 데이터 분리{'\n'}
          • 개인정보 처리 시스템의 접속 기록을 보관·점검{'\n'}
          • 전송 구간 암호화(HTTPS/TLS) 적용{'\n'}
          • 관리자 페이지 접근 시 별도 인증 절차 적용
        </Text>

        <Text style={styles.sectionTitle}>10. 개인정보 보호책임자</Text>
        <Text style={styles.body}>
          개인정보 처리에 관한 불만·문의는 아래로 연락 주세요.{'\n\n'}
          개인정보 보호책임자{'\n'}
          소속: 주식회사 아워마인{'\n'}
          이메일: admin@ourmine.co.kr{'\n'}
          처리 기간: 접수 후 7일 이내
        </Text>

        <Text style={styles.sectionTitle}>11. 권익침해 구제 방법</Text>
        <Text style={styles.body}>
          개인정보 침해로 인한 상담·분쟁 해결이 필요한 경우 아래 기관에 문의할 수 있습니다.
        </Text>
        <Text style={styles.bullet}>
          • 개인정보분쟁조정위원회: 1833-6972 (www.kopico.go.kr){'\n'}
          • 개인정보침해신고센터: 국번없이 118 (privacy.kisa.or.kr){'\n'}
          • 대검찰청 사이버수사과: 국번없이 1301 (www.spo.go.kr){'\n'}
          • 경찰청 사이버수사국: 국번없이 182 (ecrm.police.go.kr)
        </Text>

        <Text style={styles.sectionTitle}>12. 방침 변경 안내</Text>
        <Text style={styles.body}>
          본 방침이 변경될 경우 앱 내 공지를 통해 최소 7일 전에 안내합니다.
        </Text>
      </ScrollView>
    </View>
  )
}
