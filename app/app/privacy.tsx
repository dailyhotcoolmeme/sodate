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
    // 좌측·위쪽 시작 위치를 다른 페이지 제목들과 통일(16px / 8px) — privacy/terms만
    // 20이라 어긋나 있었다(2026-08-12, 오너 재지적으로 위쪽 여백도 함께 수정).
    content: { paddingHorizontal: 16, paddingTop: 8 },
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
        <Text style={styles.date}>시행일: 2026년 8월 19일 (직전 개정: 2026년 8월 13일)</Text>

        <Text style={styles.body}>
          소개팅모아(이하 "서비스")는 이용자의 개인정보를 중요하게 생각하며, 「개인정보 보호법」을 준수합니다. 본 방침을 통해 수집하는 개인정보의 항목, 이용 목적, 보유 기간 등을 안내드립니다.
        </Text>

        <Text style={styles.sectionTitle}>1. 수집하는 개인정보 항목</Text>
        <Text style={styles.body}>
          서비스는 회원가입을 요구하지 않으며, 이용자에게 실명·이메일·연락처를 요구하거나 입력받는 절차가 없습니다. 다만 아래 항목은 서비스 이용 과정에서 수집·저장됩니다.
        </Text>
        <Text style={styles.bullet}>
          {'\n'}〈자동 수집〉{'\n'}
          • 기기 식별자: 푸시 알림 토큰, 앱이 기기별로 생성·보관하는 익명 식별값, Android 기기 식별자(관심 목록 저장용){'\n'}
          • 앱 이용 기록(행동 분석): 앱 실행·화면 이동, 조회한 일정, 신청 버튼 클릭, 적용한 검색 필터(지역·나이대 등), 정렬 변경, 찜 추가·해제, 광고 노출 결과 및 각 기록의 발생 시각·세션 식별값·플랫폼 구분(iOS/Android){'\n'}
          • 광고 식별자(모바일 광고 ID / Apple IDFA): 맞춤형 광고 제공을 위해 광고 서비스(Google AdMob)를 통해 수집·이용{'\n'}
          {'\n'}〈이용자가 직접 입력하는 경우에만〉{'\n'}
          • 알림 설정 정보: 관심 지역, 관심 태그, 관심 업체, 알림 수신 여부{'\n'}
          • 후기 작성 시: 닉네임, 후기 내용, 별점, 성별, 게시물 관리(수정·삭제)용 익명 식별 토큰{'\n'}
          • 커뮤니티 게시판 이용 시: 닉네임, 글 제목·본문, 댓글 내용, 첨부 이미지, 추천·비추 기록, 조회 기록, 신고 접수 내역(신고자 익명 식별 토큰·사유 포함), 차단 목록{'\n'}
          • <Text style={{ fontWeight: '700' }}>비밀 댓글 이용 시: 이용자가 스스로 입력한 연락 수단(전화번호, 인스타그램 계정, 메신저 아이디 등)</Text>{'\n'}
          • '내 정보'에 입력하는 경우: 나이, 성별
        </Text>
        <Text style={styles.body}>
          {'\n'}후기·게시판에 입력하는 닉네임은 실명이 아니어도 되며, 익명 식별 토큰은 본인이 작성한 게시물의 수정·삭제 권한 확인과 차단 기능에만 사용됩니다.{'\n\n'}
          '내 정보'의 나이·성별은 입력을 원하는 경우에만 받으며, 기기 내 저장소에 보관되고 조건에 맞는 일정을 찾기 위한 검색 조건으로만 서버에 전송됩니다. 서버에 별도로 저장되지 않으며, 언제든 앱에서 지우거나 바꿀 수 있습니다.{'\n\n'}
          <Text style={{ fontWeight: '700' }}>비밀 댓글에 대한 안내</Text>{'\n'}
          커뮤니티의 비밀 댓글은 글 작성자와 당사자만 내용을 볼 수 있는 기능으로, 이용자가 동행·만남을 위해 연락처를 주고받는 데 사용될 수 있습니다. 이 경우 입력한 연락 수단은 서비스 서버에 저장되며, 서비스는 아래와 같이 처리합니다.
        </Text>
        <Text style={styles.bullet}>
          • 열람 범위: 해당 댓글 작성자, 게시글 작성자, (답글인 경우) 원 댓글 작성자에게만 제공됩니다.{'\n'}
          • 운영자 열람: 해당 댓글에 신고가 접수된 경우에 한해, 신고 처리 목적으로 운영자가 내용을 확인할 수 있습니다.{'\n'}
          • 연락처는 이용자가 자발적으로 입력하는 정보이며, 서비스가 입력을 요구하지 않습니다. 원치 않으면 입력하지 않아도 됩니다.{'\n'}
          • 이용자 간 연락 이후 발생하는 사항에 대해서는 이용약관 제7조가 적용됩니다.
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
          서비스는 회원 개념이 없어 서버가 '앱 삭제' 시점을 알 수 없으므로, 항목별 보유 기간을 아래와 같이 정합니다.
        </Text>
        <Text style={styles.bullet}>
          • 후기·게시판 글·댓글(첨부 이미지 포함): 이용자가 직접 삭제할 때까지. 다만 게시물이 삭제되면 그에 달린 신고 기록도 함께 삭제됩니다.{'\n'}
          • <Text style={{ fontWeight: '700' }}>비밀 댓글 내용(연락 수단 포함): 작성일로부터 6개월이 지나면 자동 파기</Text>합니다. 그 전에도 본인이 직접 삭제할 수 있습니다.{'\n'}
          • 앱 이용 기록(행동 분석): 수집일로부터 12개월{'\n'}
          • 푸시 알림 토큰·알림 설정: 알림을 끄거나 12개월 이상 앱 실행 기록이 없을 때까지{'\n'}
          • 관심 목록(찜): 이용자가 찜을 해제하거나 삭제를 요청할 때까지{'\n'}
          • 기기 차단 목록: 이용자가 차단을 해제할 때까지(해당 기기 내 저장){'\n'}
          • 이용 제한(운영자 차단) 기록: 제한 사유와 익명 식별 토큰만 보관하며, 제한이 해제될 때까지{'\n'}
          • 관계 법령에 따라 보존이 필요한 경우: 해당 법령이 정한 기간
        </Text>
        <Text style={styles.body}>
          {'\n'}보유 기간이 지나거나 처리 목적이 달성된 개인정보는 지체 없이 파기합니다. 서비스가 보유하는 개인정보는 모두 전자적 파일 형태이며, 복구·재생이 불가능한 방법으로 영구 삭제합니다. 기기 내 저장소에만 보관된 정보는 이용자가 앱을 삭제하면 함께 삭제됩니다.{'\n\n'}
          앱을 삭제하면 본인이 작성한 게시물의 수정·삭제 권한(익명 식별 토큰)이 기기에서 사라져 직접 삭제할 수 없게 됩니다. 이 경우 아래 10항의 문의처로 요청하시면 확인 후 삭제해 드립니다.
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
            이전 국가: 미국 / 이전 항목: 기기 식별자, 앱 이용 기록, 후기 정보, 커뮤니티 게시판 이용 정보(닉네임, 글·댓글 내용, 첨부 이미지, 추천·비추 기록, 조회 기록, 신고 접수 내역, 비밀 댓글에 입력한 연락 수단), 알림 설정 정보(관심 지역·태그·업체), 관심 목록(찜){'\n'}
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
          서비스는 별도의 쿠키를 사용하지 않습니다. 앱 내 설정·테마·필터 조건 등은 기기 내 저장소(AsyncStorage)에만 저장되어 외부로 전송되지 않습니다. 다만 관심 목록(찜)은 기기 식별값과 함께 서버에 저장되어 다른 화면에서도 동일하게 보이도록 처리됩니다.{'\n\n'}
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
          • 관리자 페이지 접근 시 별도 인증 절차 적용{'\n'}
          • 비밀 댓글 내용은 일반 조회 경로에서 읽을 수 없도록 데이터베이스 권한 자체를 분리하고, 열람 자격이 확인된 이용자에게만 서버가 전달
        </Text>

        <Text style={styles.sectionTitle}>9의2. 만 14세 미만 아동의 개인정보</Text>
        <Text style={styles.body}>
          서비스는 성인 대상 서비스로, 이용약관 제3조에 따라 만 19세 미만은 이용할 수 없습니다. 서비스는 만 14세 미만 아동의 개인정보를 수집하지 않으며, 만 14세 미만임이 확인된 경우 해당 정보를 지체 없이 파기합니다. 법정대리인은 아래 10항의 문의처로 아동의 개인정보 열람·정정·삭제를 요청할 수 있습니다.
        </Text>

        {/*
          개인정보 보호법 제30조 제1항 제6호는 "보호책임자의 성명 **또는** 개인정보
          보호업무 및 관련 고충사항을 처리하는 부서의 명칭과 전화번호 등 연락처"를 요구한다.
          '성명 또는 부서명'이라 개인 이름을 밝히지 않고 부서명으로 갈음할 수 있다
          (2026-08-19 조문 확인 후 오너 결정: 이름은 넣지 않는다).
        */}
        <Text style={styles.sectionTitle}>10. 개인정보 보호책임자 및 문의처</Text>
        <Text style={styles.body}>
          개인정보 처리에 관한 불만·문의는 아래로 연락 주세요.{'\n\n'}
          개인정보 보호업무 및 고충사항 처리 부서{'\n'}
          회사: 주식회사 아워마인{'\n'}
          부서: 소개팅모아 운영팀{'\n'}
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
