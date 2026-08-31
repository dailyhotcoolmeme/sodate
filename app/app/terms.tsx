import React, { useMemo } from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '@/hooks/useColors'
import TopBar from '@/components/TopBar'

export default function TermsScreen() {
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
      <TopBar showBack title="이용약관" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
        <Text style={styles.date}>시행일: 2026년 9월 2일 (직전 개정: 2026년 8월 13일)</Text>

        <Text style={styles.sectionTitle}>제1조 (목적)</Text>
        <Text style={styles.body}>
          본 약관은 모잇(이하 "서비스")가 제공하는 모바일 앱 서비스의 이용 조건 및 절차, 회사와 이용자 간의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.
        </Text>

        <Text style={styles.sectionTitle}>제2조 (서비스 정의)</Text>
        <Text style={styles.body}>
          서비스는 아래 정보를 수집·정리하여 이용자에게 제공하는 정보 중개 플랫폼이며, 이용자들이 정보를 나눌 수 있는 커뮤니티를 함께 운영합니다.
        </Text>
        <Text style={styles.bullet}>
          {'\n'}• 소개팅: 전국 로테이션 소개팅 업체의 공개된 일정 정보{'\n'}
          • 소셜링: 취미·모임 플랫폼의 공개된 모임 일정 정보{'\n'}
          • 혼술바: 혼술바·바(BAR) 등 오프라인 매장의 공개된 정보(위치, 영업시간, 편의시설, 평점 등)와 지도{'\n'}
          • 커뮤니티: 이용자가 직접 작성하는 글·댓글, 그리고 일정·매장에 대한 후기
        </Text>
        <Text style={styles.body}>
          {'\n'}서비스는 소개팅·모임을 직접 운영하거나 주최하지 않고, 혼술바 등 오프라인 매장을 직접 운영하거나 그와 제휴·중개하지 않습니다. 신청·예약이 필요한 경우 각 업체의 페이지로 연결하는 아웃링크만을 제공합니다.
        </Text>

        <Text style={styles.sectionTitle}>제3조 (서비스 이용)</Text>
        <Text style={styles.bullet}>
          • 본 서비스는 별도의 회원가입 없이 이용할 수 있습니다.{'\n'}
          • 이용자는 만 19세 이상이어야 합니다(청소년 이용불가). 만 14세 미만 아동은 이용할 수 없으며, 서비스는 만 14세 미만임이 확인된 이용자의 정보를 지체 없이 파기합니다. 각 소개팅의 실제 참가 연령 조건은 업체별로 다를 수 있습니다.{'\n'}
          • 서비스는 iOS 및 Android 기기에서 무료로 이용할 수 있습니다.{'\n'}
          • 일부 기능은 기기 권한 허용 시 이용 가능합니다. — 푸시 알림(알림 권한), 혼술바 '내 주변'·거리순 정렬(위치 권한, 앱 사용 중에만), 커뮤니티 글 사진·동영상 첨부(사진첩 권한). 권한을 허용하지 않아도 해당 기능을 제외한 나머지는 그대로 이용할 수 있으며, 허용한 권한은 언제든 기기 설정에서 해제할 수 있습니다.
        </Text>

        <Text style={styles.sectionTitle}>제4조 (서비스의 변경 및 중단)</Text>
        <Text style={styles.body}>
          서비스는 운영상 또는 기술상의 이유로 서비스 내용을 변경하거나 일시 중단할 수 있습니다. 서비스 중단 시 사전 공지를 원칙으로 하나, 긴급한 경우 사후 공지할 수 있습니다.
        </Text>

        <Text style={styles.sectionTitle}>제5조 (정보의 정확성)</Text>
        <Text style={styles.body}>
          서비스가 제공하는 아래 정보는 각 업체·플랫폼이 공개한 정보를 자동으로 수집하거나 외부 서비스에서 받아온 것으로, 실제와 다를 수 있습니다.
        </Text>
        <Text style={styles.bullet}>
          {'\n'}• 소개팅·소셜링: 일정, 가격, 장소, 모집 인원, 마감 여부 등{'\n'}
          • 혼술바: 상호, 주소·위치, 영업시간, 편의시설, 전화번호, 평점·리뷰 수·방문자 키워드(네이버 플레이스 제공), 업체 소셜 계정의 공개 이미지 등{'\n'}
          • 지도상의 표시 위치
        </Text>
        <Text style={styles.body}>
          {'\n'}특히 영업시간·휴무·마감 여부는 수시로 바뀔 수 있으므로, 방문·신청 전 반드시 해당 업체의 공식 페이지나 전화로 최신 정보를 확인하시기 바랍니다. 서비스는 정보의 정확성·최신성을 보증하지 않으며, 이로 인한 손해(헛걸음, 신청 실패 등)에 대해 책임지지 않습니다. 다만, 서비스의 고의 또는 중대한 과실로 인한 손해의 경우에는 그러하지 아니합니다.
        </Text>

        <Text style={styles.sectionTitle}>제6조 (이용자 금지 행위)</Text>
        <Text style={styles.bullet}>
          • 서비스의 정상적인 운영을 방해하는 행위{'\n'}
          • 서비스 내 정보를 무단으로 수집·복제·배포하는 행위{'\n'}
          • 타인의 정보를 도용하거나 허위 정보를 입력하는 행위{'\n'}
          • 후기·게시판 글·댓글 등에 욕설·비방·명예훼손, 음란·혐오 표현, 허위 사실, 광고·홍보성 내용을 게시하는 행위{'\n'}
          • 관련 법령을 위반하는 일체의 행위
        </Text>

        <Text style={styles.sectionTitle}>제6조의2 (이용자 게시물 및 후기)</Text>
        <Text style={styles.body}>
          ① 이용자는 로그인 없이 후기·게시판 글·댓글(이하 "게시물")을 작성할 수 있으며, 본인이 작성한 게시물은 기기에 저장된 익명 식별 토큰을 통해 본인만 수정·삭제할 수 있습니다. 앱 삭제 또는 기기 변경 시 해당 권한은 복구되지 않습니다.{'\n\n'}
          ② 이용자가 게시한 게시물의 내용에 대한 책임은 작성자 본인에게 있으며, 서비스는 게시물의 진실성·정확성을 보증하지 않습니다.{'\n\n'}
          ③ 서비스는 부적절 표현 자동 필터링, 신고 기능, 특정 작성자 게시물 차단(뮤트) 기능을 제공하며, 신고가 접수되거나 아래 금지 내용에 해당하는 게시물은 사전 통지 없이 삭제 또는 노출 제한(블라인드)할 수 있습니다. 서비스는 부적절 게시물 신고에 대해 접수 후 24시간 이내에 조치하며, 불법·유해 게시물에 대해 무관용 원칙을 적용합니다.{'\n\n'}
          ④ 이용자는 게시물을 게시함으로써 서비스가 해당 게시물을 서비스 내에서 게시·노출하는 데 필요한 범위에서 이용할 수 있도록 허락합니다.{'\n\n'}
          ⑤ 게시판 글·댓글, 그리고 일정·매장 후기를 새로 등록할 때는 본 조에 대한 동의 절차를 거칩니다.
        </Text>

        <Text style={styles.sectionTitle}>제6조의3 (비밀 댓글 및 이용자 간 연락)</Text>
        <Text style={styles.body}>
          ① 커뮤니티의 비밀 댓글은 해당 댓글 작성자, 게시글 작성자, 답글인 경우 원 댓글 작성자만 내용을 볼 수 있는 기능입니다.{'\n\n'}
          ② 이용자는 비밀 댓글에 연락 수단(전화번호, 메신저 아이디, SNS 계정 등)을 스스로 선택해 남길 수 있습니다. 서비스는 이를 요구하지 않으며, 남기지 않아도 서비스 이용에 제한이 없습니다.{'\n\n'}
          ③ 비밀 댓글에 신고가 접수된 경우, 서비스는 신고 처리에 필요한 범위에서 해당 내용을 확인할 수 있습니다. 그 밖의 경우에는 열람하지 않습니다.{'\n\n'}
          ④ 비밀 댓글의 내용은 개인정보처리방침이 정한 보유 기간이 지나면 자동으로 파기됩니다.{'\n\n'}
          ⑤ 서비스는 이용자 간 연락·만남을 중개하지 않으며, 이용자가 서로 주고받은 연락처로 연락한 이후 발생하는 일체의 분쟁·피해에 대해 책임지지 않습니다. 이용자는 낯선 상대와 연락·만남을 진행할 때 스스로 주의를 기울여야 합니다. 다만, 서비스의 고의 또는 중대한 과실로 인한 손해의 경우에는 그러하지 아니합니다.
        </Text>

        <Text style={styles.sectionTitle}>제7조 (책임 한계)</Text>
        <Text style={styles.body}>
          서비스는 이용자와 소개팅 업체 간의 거래에 개입하지 않으며, 업체와의 분쟁, 환불, 불만 사항에 대해 책임지지 않습니다. 소개팅 신청, 결제, 참가는 전적으로 해당 업체와 이용자 간의 계약 관계입니다. 다만, 서비스의 고의 또는 중대한 과실로 인한 손해의 경우에는 그러하지 아니합니다.
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
          이메일: admin@ourmine.co.kr
        </Text>
      </ScrollView>
    </View>
  )
}
