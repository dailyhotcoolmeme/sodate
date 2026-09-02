/**
 * 리치 에디터가 뱉은 HTML 을 저장하기 좋은 형태로 다듬는다(2026-09-02).
 *
 * ## 왜 필요한가
 * `react-native-enriched-html` 의 `getHTML()` 은 **한글을 전부 숫자 코드로 이스케이프**한다.
 *
 *     <html>\n<p>&#47560;&#51648;&#47561; &#45843;&#44544;</p>\n</html>   ← "마지막 댓글"
 *
 * 이걸 그대로 DB 에 넣어 놨더니, 그 라이브러리가 **빌드에 안 들어 있는 앱**에서는 코드를
 * 풀 방법이 없어 글이 통째로 안 읽혔다(2026-09-02 오너 제보 — iOS 라이브 1.0.x 는 심사
 * 중이라 아직 그 라이브러리가 없는 빌드다). 8/26 이후 글 6건이 전부 그 상태였다.
 *
 * ## 그래서 두 가지를 한다
 * 1. **한글 코드를 실제 글자로 되돌린다.**
 * 2. **서식이 없으면 HTML 을 벗기고 평문으로 저장한다.** 굵게·목록 하나 없는 글을
 *    `<html><p>…</p></html>` 로 감싸 둘 이유가 없다. 평문이면 어느 앱 버전에서든 그냥 보인다.
 *
 * ## ⚠️ `&lt;` `&gt;` `&amp;` 는 HTML 안에서 풀면 안 된다
 * 사용자가 본문에 `<b>` 라고 **글자로** 쓰면 에디터는 `&lt;b&gt;` 로 내보낸다. 이걸 풀면
 * 진짜 태그가 되어 버린다. 그래서 HTML 을 유지하는 경우에는 **127 초과 문자(한글·이모지
 * 등)만** 되돌리고 나머지는 손대지 않는다. 평문으로 내릴 때만 전부 푼다 — 그때는 결과가
 * 마크업이 아니라 글자이기 때문이다.
 */

/** 숫자 실체참조 중 **비ASCII만** 되돌린다(`&#60;` → `<` 같은 태그 생성 방지). */
function decodeNonAscii(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => {
      const c = parseInt(h, 16)
      return c > 127 ? String.fromCodePoint(c) : m
    })
    .replace(/&#(\d+);/g, (m, d) => {
      const c = parseInt(d, 10)
      return c > 127 ? String.fromCodePoint(c) : m
    })
}

/** 평문으로 내릴 때만 쓰는 전체 디코드. `&amp;` 는 마지막에 — 먼저 풀면 두 번 풀린다. */
function decodeAll(s: string): string {
  return decodeNonAscii(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** 남은 태그가 있는지 — 문단·줄바꿈을 걷어낸 뒤에 본다. */
const ANY_TAG = /<[a-zA-Z!/][^>]*>/

/**
 * 에디터 HTML → 저장할 값.
 * 서식이 있으면 HTML 그대로(한글만 복원), 없으면 평문.
 */
export function normalizeEditorHtml(raw: string): string {
  if (!raw) return ''
  const decoded = decodeNonAscii(raw)
  // 라이브러리가 항상 씌우는 <html> 껍데기는 저장할 이유가 없다.
  const inner = decoded.replace(/^\s*<html>\s*/i, '').replace(/\s*<\/html>\s*$/i, '')

  // 문단·줄바꿈만 남은 글인지 본다 — 그건 '서식'이 아니다.
  const asText = inner
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p[^>]*>/gi, '')
  if (ANY_TAG.test(asText)) return inner   // 굵게·목록·링크 등이 있다 → HTML 유지

  const text = decodeAll(asText).replace(/\n{3,}/g, '\n\n').trim()
  // 평문으로 풀었더니 태그처럼 보이면(사용자가 <b> 를 글자로 쓴 경우) HTML 로 둔다 —
  // 평문으로 저장하면 보는 쪽에서 이걸 서식으로 착각한다.
  return ANY_TAG.test(text) ? inner : text
}
