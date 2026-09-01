import React, { useMemo } from 'react'
import { Modal, View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'

/**
 * 제휴 혜택 안내 — 상세 화면에 **들어오자마자** 뜨는 팝업(2026-09-02 오너 지시).
 *
 * ## 왜 들어올 때인가 (나갈 때가 아니라)
 * 처음엔 '신청하기'를 눌러 업체 페이지로 나가기 직전에 띄우려 했는데 오너가 반려했다 —
 * *"나가기 직전 팝업이면 의미가 없잖아! 어차피 신청할 사람이 할인만 받은 건데."*
 * 맞는 지적이다. 그 자리는 이미 신청하기로 마음먹은 사람만 보므로 할인 비용만 나가고
 * 신청률은 그대로다. 들어올 때 띄워야 "그래서 여기로 신청하자"가 된다.
 *
 * ## 구성 (오너가 직접 잡은 순서)
 *   모잇 할인
 *   → 무엇을 하면 되는지 (한 문장)
 *   → 혜택 내용 (강조, **비어 있으면 이 줄 자체를 안 그린다**)
 *   [확인]
 * 혜택이 비었을 때 "할인됩니다" 같은 문구로 채우지 않는다 — 빈 말이 한 줄 늘 뿐이다.
 *
 * ## 소개팅·소셜링과 혼술바는 행동이 다르다
 * 소개팅은 신청 절차가 있고, 혼술바는 그냥 방문한다. 그래서 안내 문장이 다르다.
 * '신청서에'라고 못 박지 않는 이유는 신청이 폼일 수도 전화·DM일 수도 있어서다.
 *
 * ## 제목 위 안내 줄은 없다(2026-09-02 오너 지시로 제거)
 * 팝업을 다시 읽을 자리로 제목 위에 핑크 한 줄을 뒀었는데, 그 화면은 딱지·해시태그·
 * 가격이 전부 핑크라 한 줄이 더 붙자 "온통 핑크색이라 정신없다"는 지적을 받았다.
 * 안내는 팝업 하나로 끝낸다.
 *
 * ## 다시 보지 않기를 두지 않는다(오너 지시)
 * 한 번 체크해두면 정작 필요할 때 안 뜬다. 상세 진입 1회당 한 번만 뜨므로 성가시지 않다.
 */
export type PartnerKind = 'event' | 'place'

export function partnerActionText(kind: PartnerKind): string {
  return kind === 'place'
    ? '매장에서 모잇 앱을 보여주시면\n서비스를 받으실 수 있어요'
    : '신청하실 때 "모잇 통해서 신청"이라고\n알려주시면 혜택을 받을 수 있어요'
}

export default function PartnerNotice({
  visible,
  kind,
  benefit,
  onClose,
}: {
  visible: boolean
  kind: PartnerKind
  /** 업체별 혜택 문구. 비어 있으면 혜택 줄을 안 그린다. */
  benefit?: string | null
  onClose: () => void
}) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const b = (benefit ?? '').trim()

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        {/* 바깥을 눌러도 닫힌다 — 확인만 누르게 가두면 팝업이 함정처럼 느껴진다. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.card}>
          <Text style={styles.title}>모잇 할인</Text>
          <Text style={styles.action}>{partnerActionText(kind)}</Text>
          {!!b && (
            <View style={styles.benefitBox}>
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          )}
          <TouchableOpacity style={styles.ok} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.okText}>확인</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    // MY 팝업(mCard)과 같은 규격 — 앱 안에서 팝업 생김새를 하나로 유지한다.
    card: {
      width: '100%',
      maxWidth: 360,
      borderRadius: 16,
      backgroundColor: colors.surface,
      padding: 22,
      alignItems: 'center',
      gap: 14,
    },
    // ⚠️ 이 팝업에서 제일 눈에 띄어야 하는 건 **혜택**이지 닫기 버튼이 아니다.
    //    처음엔 '확인'을 꽉 찬 핑크 큰 버튼으로 두고 혜택은 그냥 글자였는데, 화면에서
    //    제일 크고 진한 것이 닫기 버튼이라 눈이 거기로 갔다(2026-09-02 오너 지적).
    //    그래서 크기·색의 순서를 뒤집었다: 제목 > 혜택 박스 > 본문 > 확인.
    title: { fontSize: 24, lineHeight: 32, color: colors.primary, fontWeight: '900', textAlign: 'center' },
    action: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, fontWeight: '600', textAlign: 'center' },
    // 혜택은 박스로 둘러 강조한다 — 글자만으로는 본문에 묻힌다.
    benefitBox: {
      alignSelf: 'stretch',
      backgroundColor: `${colors.primary}1F`,
      borderWidth: 1.5,
      borderColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
      alignItems: 'center',
    },
    benefitText: { fontSize: 22, lineHeight: 30, color: colors.primary, fontWeight: '900', textAlign: 'center' },
    // 확인은 조용하게. 눌러야 닫히는 건 알아야 하니 버튼 모양은 유지하되 색을 뺀다.
    ok: {
      alignSelf: 'stretch',
      marginTop: 2,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
      backgroundColor: colors.surfaceHigh,
    },
    okText: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
  })
}
