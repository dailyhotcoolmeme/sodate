import React from 'react'
import { Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native'
import { RICH_EDITOR_AVAILABLE } from './BoardRichEditor'

/**
 * 게시글 본문 렌더러. 리치 글(HTML)이면 서식대로, 아니면 평문.
 * - HTML 렌더는 react-native-enriched-html(완전 네이티브)이 있을 때만. 없으면 태그를
 *   벗겨 평문으로 보여준다(옛 앱 호환).
 * - 옛 평문 글은 그대로 <Text> 로 렌더.
 *
 * ⚠️(2026-08-25) 예전엔 웹뷰로 렌더했는데(높이를 웹뷰가 스스로 재서 보고하는 방식),
 * 그 높이 보고가 화면에 반영이 안 따라가서 글 마지막 줄이 중간에서 잘린 채 몇 초가
 * 지나도 안 고쳐지는 사고가 났다(오너 제보: "텍스트가 잘리고 있는 상황" — 실기기
 * 글로 재현·확정). 웹뷰를 아예 없애는 쪽(EnrichedText, 글쓰기 입력칸과 같은
 * 라이브러리)으로 교체 — 네이티브 텍스트 레이아웃이라 이 문제군 자체가 성립 안 한다.
 */
let EnrichedText: any = null
if (RICH_EDITOR_AVAILABLE) {
  EnrichedText = require('react-native-enriched-html').EnrichedText
}

export function isHtml(s: string | null | undefined): boolean {
  return !!s && /<(p|br|strong|em|u|s|h[1-6]|ul|ol|li|blockquote|img|a|code|pre|span)\b/i.test(s)
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n').trim()
}

interface Props {
  content: string
  textStyle: StyleProp<TextStyle>
  colors: { textPrimary: string; background: string; primary: string }
}

export default function PostHtmlView({ content, textStyle, colors }: Props) {
  if (!isHtml(content)) {
    return <Text style={textStyle} selectable>{content}</Text>
  }
  if (!EnrichedText) {
    // 옛 앱(라이브러리 없음)에서 리치 글을 볼 때 — 태그 벗겨 평문으로.
    return <Text style={textStyle} selectable>{stripTags(content)}</Text>
  }

  return (
    <EnrichedText
      selectable
      htmlStyle={{ a: { color: colors.primary } }}
      style={StyleSheet.flatten([{ color: colors.textPrimary }, textStyle])}
    >
      {content}
    </EnrichedText>
  )
}
