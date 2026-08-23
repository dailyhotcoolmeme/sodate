import React, { useState } from 'react'
import { Text, View, StyleSheet, type StyleProp, type TextStyle } from 'react-native'
import { RICH_EDITOR_AVAILABLE } from './BoardRichEditor'

/**
 * 게시글 본문 렌더러. 리치 글(HTML)이면 서식대로, 아니면 평문.
 * - HTML 렌더는 webview 가 있을 때만(재빌드 후). 없으면 태그를 벗겨 평문으로 보여준다(옛 앱 호환).
 * - 옛 평문 글은 그대로 <Text> 로 렌더.
 */
let WebView: any = null
if (RICH_EDITOR_AVAILABLE) {
  WebView = require('react-native-webview').WebView
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
  const [height, setHeight] = useState(40)

  if (!isHtml(content)) {
    return <Text style={textStyle} selectable>{content}</Text>
  }
  if (!WebView) {
    // 옛 앱(webview 없음)에서 리치 글을 볼 때 — 태그 벗겨 평문으로.
    return <Text style={textStyle} selectable>{stripTags(content)}</Text>
  }

  // 리치 글 HTML 을 webview 로 렌더(높이는 내용에 맞춰 자동). 링크/이미지 최대폭 제한.
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      body{margin:0;padding:0;font-family:-apple-system,system-ui,'Apple SD Gothic Neo',sans-serif;
        font-size:15px;line-height:1.55;color:${colors.textPrimary};background:${colors.background};
        word-break:break-word;-webkit-text-size-adjust:100%;}
      img{max-width:100%;height:auto;border-radius:8px;}
      a{color:${colors.primary};}
      blockquote{margin:8px 0;padding:6px 12px;border-left:3px solid ${colors.primary}55;color:${colors.textPrimary};opacity:.85;}
      pre,code{background:rgba(127,127,127,.14);border-radius:6px;padding:1px 5px;font-size:13.5px;}
      pre{padding:10px;overflow:auto;}
      ul,ol{padding-left:22px;} h1,h2,h3{margin:.4em 0;}
    </style></head><body>${content}
    <script>
      function post(){window.ReactNativeWebView && window.ReactNativeWebView.postMessage(String(document.body.scrollHeight));}
      window.addEventListener('load',post); setTimeout(post,300);
      new (window.ResizeObserver||function(){this.observe=function(){}})(post).observe(document.body);
    </script></body></html>`

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={{ backgroundColor: 'transparent', height }}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        onMessage={(e: any) => {
          const h = Math.ceil(Number(e.nativeEvent.data))
          if (h && Math.abs(h - height) > 2) setHeight(h)
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
})
