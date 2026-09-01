import React, { useMemo, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import TopBar from '@/components/TopBar'

/**
 * 제휴 문의 안내 화면(2026-09-01 오너 지시, 문구 확정본).
 *
 * 예전엔 설정·MY 의 '제휴문의'를 누르면 **빈 메일**이 바로 열렸다. 업체는 무엇을 써야
 * 할지 모르고, 우리가 무엇을 해주는지도 모른 채 메일을 썼다. 그래서 안내를 먼저 보여주고
 * 마지막에 **양식이 채워진 메일**을 열어준다.
 *
 * 디자인은 새로 만들지 않고 앱에 이미 있는 것을 그대로 쓴다 —
 * 여백·제목 크기는 이용약관(app/terms.tsx), 칩은 혼술바(app/honsul/index.tsx),
 * 하단 버튼은 온보딩(app/onboarding.tsx) 과 같은 값이다.
 */

type Kind = 'dating' | 'socialing' | 'honsul'

const KINDS: { key: Kind; label: string; mailLabel: string }[] = [
  { key: 'dating', label: '로테이션 소개팅', mailLabel: '로테이션 소개팅' },
  { key: 'socialing', label: '소셜링 모임', mailLabel: '소셜링 모임' },
  { key: 'honsul', label: '혼술바', mailLabel: '혼술바' },
]

/** 대상별 혜택 — 문구는 오너 확정본 그대로. */
const BENEFITS: Record<Kind, string[]> = {
  dating: [
    '일정 목록에서 상단에 고정해 먼저 보이게 합니다',
    '목록에서 눈에 띄는 표시를 붙입니다',
    '업체 소개 페이지에 사진·소개글·채널 링크를 실어드립니다',
    '커뮤니티 상단 배너에 노출합니다',
    '조회수·신청 클릭수를 월 1회 정리해 보내드립니다',
  ],
  socialing: [
    '모임이 속한 카테고리 상단에 고정합니다 (독서·러닝·보드게임 등)',
    '목록에서 눈에 띄는 표시를 붙입니다',
    '커뮤니티 상단 배너에 노출합니다',
    '참여 현황을 월 1회 정리해 보내드립니다',
  ],
  honsul: [
    '목록과 지도에서 눈에 띄게 표시합니다',
    '사진·메뉴·영업시간·인스타그램을 넓게 실어드립니다',
    '이번 주 추천 혼술바로 소개합니다',
    '커뮤니티 상단 배너에 노출합니다',
    '조회수·길찾기 클릭수를 월 1회 정리해 보내드립니다',
  ],
}

const FAQ: { q: string; a: string }[] = [
  { q: '비용이 드나요?', a: '들지 않습니다. 이용자 할인 외에 저희가 받는 것은 없습니다.' },
  { q: '계약서를 써야 하나요?', a: '아닙니다. 메일로 조건만 합의하면 시작합니다.' },
  { q: '그만두고 싶으면요?', a: '메일 한 통이면 됩니다. 위약금·최소 기간 없습니다.' },
  {
    q: '어떤 기준으로 노출해 주나요?',
    a: '제휴사를 먼저 보여드립니다. 다만 마감된 일정이나 영업이 끝난 매장은 제외됩니다.',
  },
  {
    q: '정보가 틀리게 올라와 있어요.',
    a: '알려주시면 바로 고칩니다. 제휴 여부와 관계없이 해드립니다.\n앞으로는 업체가 일정과 매장 정보를 직접 올리고 수정하는 화면을 따로 만들 예정입니다. 준비되면 제휴사부터 먼저 안내드립니다.',
  },
  {
    q: '자리가 한정돼 있나요?',
    a: '네. 상단 노출과 배너 자리는 수가 정해져 있어, 먼저 문의해 주신 곳부터 배정합니다.',
  },
]

const CONTACT = 'admin@ourmine.co.kr'
const INSTAGRAM = 'https://www.instagram.com/love_observer_moit?igsi=b2poeG1yNHN0cmJq'

export default function PartnerScreen() {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [kind, setKind] = useState<Kind>('dating')

  const current = KINDS.find((k) => k.key === kind)!

  const openInstagram = () => {
    Linking.openURL(INSTAGRAM).catch(() => Alert.alert('오류', '링크를 열 수 없습니다'))
  }

  /** 고른 대상에 맞는 제목·양식을 채운 메일을 연다. 업체는 빈칸만 채우면 된다. */
  const sendMail = () => {
    const subject = `[모잇 제휴문의] ${current.mailLabel} — (업체명)`
    const body = [
      '업체명 :',
      '지역·주소 :',
      '담당자·연락처 :',
      '홈페이지·인스타 :',
      '제안 가능한 할인 :',
      '하고 싶은 말 :',
      '',
      '──────────────',
      '※ 위 항목만 채워 보내주시면 확인 후 연락드립니다.',
    ].join('\n')
    const url = `mailto:${CONTACT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    Linking.openURL(url).catch(() =>
      Alert.alert('메일 앱을 열 수 없습니다', `${CONTACT} 으로 보내주세요.`),
    )
  }

  return (
    <View style={styles.container}>
      {/* title 을 주면 로고 대신 글자 제목이 뜬다 — 여기선 앱아이콘+모잇 로고를 보여준다(오너 지시). */}
      <TopBar showBack />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        {/* ① 한 줄 제안 */}
        <Text style={styles.headline}>모잇에서 먼저 보이게 해드립니다</Text>
        <Text style={styles.lead}>
          지역과 조건으로 찾는 이용자에게, 제휴사의 일정이 눈에 띄는 자리에 놓입니다.
        </Text>

        {/* ② 모잇은 어떤 앱인가 */}
        <Text style={styles.sectionTitle}>모잇은 어떤 앱인가요</Text>
        <Text style={styles.body}>
          모잇은 소개팅·소셜링·혼술바를 한곳에서 찾아보는 앱입니다.{'\n'}
          흩어져 있어 일일이 찾아다녀야 했던 것들을 한 화면에 모아, 지역·날짜·가격으로 골라 보고
          바로 신청까지 갈 수 있게 했습니다.{'\n'}
          이용자들이 후기와 정보를 나누는 커뮤니티도 함께 운영합니다.
        </Text>
        <TouchableOpacity style={styles.igRow} onPress={openInstagram} activeOpacity={0.7}>
          <Ionicons name="logo-instagram" size={18} color={colors.primary} />
          <Text style={styles.igText}>인스타그램에서 모잇 보기</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
        </TouchableOpacity>

        {/* ③ 대상 고르기 */}
        <Text style={styles.sectionTitle}>어떤 서비스를 운영하시나요?</Text>
        <View style={styles.chipRow}>
          {KINDS.map((k) => {
            const on = k.key === kind
            return (
              <TouchableOpacity
                key={k.key}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => setKind(k.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{k.label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        {/* ④ 대상별 혜택 */}
        <Text style={styles.sectionTitle}>{current.label} 제휴사에 드리는 것</Text>
        <View style={styles.benefitBox}>
          {BENEFITS[kind].map((b) => (
            <View key={b} style={styles.benefitRow}>
              <Ionicons name="checkmark" size={16} color={colors.primary} style={styles.benefitIcon} />
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>

        {/* ⑤ 대신 부탁드리는 것 */}
        <Text style={styles.sectionTitle}>대신 부탁드리는 것</Text>
        <View style={styles.askBox}>
          <Text style={styles.askTitle}>모잇 이용자에게 할인을 주세요</Text>
          <Text style={styles.body}>
            제휴 비용은 받지 않습니다. 대신 <Text style={styles.strong}>&ldquo;모잇 통해서 신청&rdquo;</Text> 을 언급한
            참여자에게 할인을 적용해 주세요.{'\n'}
            할인 폭과 방식은 업체 사정에 맞춰 협의합니다. 무리한 조건을 요구하지 않습니다.
          </Text>
          <Text style={styles.askNote}>
            할인 적용 여부를 저희가 따로 확인하지 않습니다. 업체를 믿고 시작합니다.
          </Text>
        </View>

        {/* ⑥ 자주 묻는 질문 */}
        <Text style={styles.sectionTitle}>자주 묻는 질문</Text>
        {FAQ.map((f) => (
          <View key={f.q} style={styles.faqItem}>
            <Text style={styles.faqQ}>{f.q}</Text>
            <Text style={styles.faqA}>{f.a}</Text>
          </View>
        ))}

        {/* ⑦ 문의하기 */}
        <TouchableOpacity style={styles.cta} onPress={sendMail} activeOpacity={0.85}>
          <Ionicons name="mail-outline" size={18} color="#fff" />
          <Text style={styles.ctaText}>{current.label} 제휴 문의하기</Text>
        </TouchableOpacity>
        <Text style={styles.ctaHint}>
          누르면 메일 앱이 열립니다. 항목만 채워 보내주세요.{'\n'}
          {CONTACT}
        </Text>
      </ScrollView>
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    // 좌우·위 여백은 이용약관 화면과 같은 값(16 / 8)으로 맞춘다.
    content: { paddingHorizontal: 16, paddingTop: 8 },

    // 첫 줄은 브랜드 핑크로 — 오너 지시(2026-09-01).
    headline: { fontSize: 22, fontWeight: '800', color: colors.primary, lineHeight: 30 },
    lead: { fontSize: 14, color: colors.textSecondary, lineHeight: 22, marginTop: 8 },

    sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginTop: 28, marginBottom: 8 },
    body: { fontSize: 14, color: colors.textSecondary, lineHeight: 22 },
    strong: { color: colors.textPrimary, fontWeight: '700' },
    igRow: {
      flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12,
      alignSelf: 'flex-start', paddingVertical: 4,
    },
    igText: { fontSize: 13, fontWeight: '600', color: colors.primary },

    // 칩 — 혼술바 화면과 같은 규격.
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 13, paddingVertical: 7, borderRadius: 18,
      backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.border,
    },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
    chipTextOn: { color: '#fff', fontWeight: '700' },

    benefitBox: {
      backgroundColor: `${colors.primary}14`, borderRadius: 14, padding: 14, gap: 10,
      borderWidth: 1, borderColor: `${colors.primary}33`,
    },
    benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    // 체크 아이콘과 글의 첫 줄을 맞춘다(행잉 인덴트) — 줄이 넘어가도 글이 아이콘 아래로 안 들어간다.
    benefitIcon: { marginTop: 3 },
    benefitText: { flex: 1, fontSize: 14, color: colors.textSecondary, lineHeight: 22 },

    askBox: {
      backgroundColor: `${colors.primary}14`, borderRadius: 14, padding: 14,
      borderWidth: 1, borderColor: `${colors.primary}33`,
    },
    askTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
    askNote: { fontSize: 13, color: colors.textTertiary, lineHeight: 20, marginTop: 10 },

    faqItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
    faqQ: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 6 },
    faqA: { fontSize: 14, color: colors.textSecondary, lineHeight: 22 },

    // 하단 버튼 — 온보딩 '다음' 버튼과 같은 규격.
    cta: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, marginTop: 28,
    },
    ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    ctaHint: { fontSize: 12, color: colors.textTertiary, textAlign: 'center', lineHeight: 20, marginTop: 10 },
  })
}
