import React, { forwardRef, useImperativeHandle, useEffect, useMemo, useRef } from 'react'
import { View, StyleSheet } from 'react-native'
import {
  RichText, useEditorBridge, useEditorContent, BridgeExtension,
  CoreBridge, BoldBridge, ItalicBridge, UnderlineBridge, StrikeBridge,
  HeadingBridge, BulletListBridge, OrderedListBridge, BlockquoteBridge,
  CodeBridge, LinkBridge, ColorBridge, HighlightBridge, ImageBridge,
  HistoryBridge, PlaceholderBridge, ListItemBridge,
} from '@10play/tentap-editor'
import { TrailingNode } from '@tiptap/extensions'
import type { AppColors } from '@/constants/colors'
import type { RichEditorHandle, RichEditorProps } from './BoardRichEditor'

/**
 * tentap(리치텍스트) 실제 구현. webview 네이티브가 바이너리에 있을 때만 렌더된다.
 * 툴바는 여기서 그리지 않는다 — 키보드 위에 고정해야 해서(KeyboardStickyView) 부모가
 * onEditorReady 로 받은 editor 로 BoardRichToolbar 를 화면 하단에 따로 그린다.
 */

// ⚠️(2026-08-25) 문서가 이미지로 끝나면 그 뒤에 커서를 놓을 빈 줄이 없다 — 그 상태에서
// 이미지 영역을 탭하면 이미지 "노드"가 선택되고, 그대로 타이핑하면 이미지가 통째로
// 지워지고 글자로 바뀌어버렸다(오너 지적: "이미지 첨부 1개 하면 어느 무엇도 작성하기
// 힘들게 되어있다. 완전히 최악이라고!" — 시뮬레이터로 재현해서 확인: 사진 삽입 후 그
// 자리를 탭하고 타이핑하니 사진이 사라지고 글자로 바뀜). 직접 짜지 않고 tiptap 팀이
// 정확히 이 문제(이미지·표 등 뒤에 탭할 곳이 없는 문제)를 위해 공식 제공하는
// TrailingNode 확장을 쓴다 — 문서 끝이 이미지면 항상 빈 문단을 하나 더 붙여줘서
// 그 빈 문단을 탭해 안전하게 이어 쓸 수 있게 한다.
const TrailingParagraphBridge = new BridgeExtension({
  tiptapExtension: TrailingNode.configure({ node: 'paragraph' }),
})
export default forwardRef<RichEditorHandle, RichEditorProps & { colors: AppColors }>(function BoardRichEditorImpl(
  { initialHTML, placeholder, onChangeText, onReady, onEditorReady, colors },
  ref,
) {
  // ⚠️(2026-08-25) bridgeExtensions 배열을 렌더마다 새로 만들면(인라인 배열 리터럴)
  // useEditorBridge 가 매번 "설정이 바뀌었다"고 보고 내부적으로 다시 초기화 → 그게 다시
  // 리렌더를 유발 → 또 새 배열... 이 무한 루프에 빠졌다("Maximum update depth exceeded",
  // 실기기에서 터치가 완전히 먹통되던 원인 — 시뮬레이터로 직접 재현해서 실제 에러 로그로
  // 확인함). useMemo 로 배열 참조를 고정해서 이 루프를 끊는다.
  const bridgeExtensions = useMemo(() => [
    // 본문 내부 패딩을 제목 입력칸(paddingHorizontal 14 · paddingVertical 12)과 맞춘다.
    CoreBridge.configureCSS(`
      .ProseMirror { padding: 12px 14px; font-size: 15px; line-height: 1.5; }
      .ProseMirror p { margin: 0 0 8px; }
      /* ⚠️(2026-08-25) max-width:100% 만 있으면 사진 한 장이 본문 가로·세로를 통째로
         잡아먹었다(오너 지적: "이미지 첨부하는 순간 이미지가 본문 가로세로 사이즈를
         완전히 잡아먹는데"). 썸네일 크기(최대 200×200)로 제한하고 원본 비율은 유지한다. */
      .ProseMirror img { display: block; max-width: 200px; max-height: 200px; width: auto; height: auto; border-radius: 8px; }
    `),
    HistoryBridge, ListItemBridge,
    BoldBridge, ItalicBridge, UnderlineBridge, StrikeBridge,
    HeadingBridge, BulletListBridge, OrderedListBridge, BlockquoteBridge,
    CodeBridge, LinkBridge.configureExtension({ openOnClick: false }),
    ColorBridge, HighlightBridge, ImageBridge, TrailingParagraphBridge,
    PlaceholderBridge.configureExtension({ placeholder: placeholder || '내용을 입력하세요' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [placeholder])

  // 툴바 배경·아이콘 색을 앱 톤(회색)으로 통일한다 — tentap 기본 테마는 배경이 흰색
  // 고정이라 앱 배경색과 갈라져 보였다(오너 지적: "배경색을 모두 회색으로 통일시키고").
  // 다크모드에서 흰 배경이 튀어보이던 것도 같이 해결된다. 이 theme 은 순수 RN 스타일
  // 객체 병합(mergeThemes)일 뿐 webview 브릿지를 안 타므로 무한 루프와는 무관하다.
  const editorTheme = useMemo(() => ({
    toolbar: {
      // ⚠️(2026-08-25) tentap 기본 toolbarBody 는 flex:1 이 박혀있다 — 원래는 한 줄짜리
      // 툴바 하나만 쓰는 걸 가정한 스타일이라 문제가 없었는데, 우리는 상단 고정을 위해
      // 이 컴포넌트를 여러 줄(BoardRichToolbar 인스턴스 3개)로 쌓아 쓴다. flex:1 이 그대로
      // 살아있으면 박스 안의 flex:1 형제(각 줄 + 에디터 본문)가 남는 높이를 균등하게
      // 나눠 가져가버려서 툴바 3줄이 상단에 붙지 않고 박스 전체에 넓게 퍼져버렸다(오너
      // 지적: "3줄이 입력박스 전체에 걸쳐서 밑으로 내려온다"). flex:0 으로 눌러서
      // height:44 만큼만 차지하게 고정한다.
      toolbarBody: { flex: 0, backgroundColor: colors.surfaceHigh, borderTopColor: colors.divider, borderBottomColor: colors.divider },
      toolbarButton: { backgroundColor: colors.surfaceHigh },
      iconWrapper: { backgroundColor: colors.surfaceHigh },
      iconWrapperActive: { backgroundColor: colors.divider },
      icon: { tintColor: colors.textSecondary },
      iconDisabled: { tintColor: colors.textTertiary },
    },
  }), [colors])

  const editor = useEditorBridge({
    autofocus: false,
    // ⚠️(2026-08-25) avoidIosKeyboard:true 로 한 번 켜봤는데(키보드가 입력칸을 가리는 문제
    // 고치려고) tentap 이 내부적으로 editor.updateScrollThresholdAndMargin() 을 호출해서
    // 웹뷰 "내부" 스크롤 동작 자체를 자기 것으로 바꿔버리는데, 그게 이미지 삽입 후 스크롤이
    // 막혀서 이미지 아래 내용에 손을 못 대는 새 사고를 냈다(오너 지적: "이미지를 첨부하면
    // 이미지 하단이 입력박스 내부에서 스크롤이 안늘어나서 이미지 밑에는 가지도 못하고").
    // 원인 파악 전까지 원복 — 키보드 가림 문제는 미해결 상태로 남지만, 스크롤이 아예 막히는
    // 것보다는 낫다.
    avoidIosKeyboard: false,
    // ⚠️(2026-08-25) dynamicHeight:true + 직접 onMessage 로 높이를 받아 적용하는 방식을
    // 시도했다가 이미지 삽입 자체가 무한 로딩(스피너가 안 멈춤)에 빠지는 걸 확인해서
    // 바로 원복했다 — exclusivelyUseCustomOnMessage:false 로 tentap 내부 처리도 같이
    // 돌게 했는데도 getHTML() 의 비동기 응답(같은 메시지 채널 사용)이 막힌 것으로 보인다.
    // 스크롤 문제(웹뷰 내부 오버플로우 숨음)는 여전히 미해결 — dynamicHeight 를 통한
    // 해결은 이 프로젝트 환경에서 두 번 다 실패했으니 완전히 다른 방법이 필요하다.
    initialContent: initialHTML || '',
    bridgeExtensions,
    theme: editorTheme,
  })

  useImperativeHandle(ref, () => ({
    getHTML: () => editor.getHTML(),
    // ⚠️(2026-08-25) editor.setImage() 하나만 쓰던 예전 방식은(TrailingNode 확장이
    // 이미지 뒤에 빈 문단을 자동으로 붙여줄 거라 기대) 실기기에서 재현됐다 — "그림
    // 다음줄에 텍스트 입력을 죽어도 못한다", "첫번째 줄에 텍스트 없는 상태에서
    // 이미지 첨부하면 절대로 첫번째 줄에 텍스트 입력을 못한다"(오너 지적). tentap
    // setImage 내부 커맨드 체인과 커스텀 확장(TrailingNode)이 실제로 웹뷰에서 항상
    // 기대대로 동작한다고 확신할 수 없어서(둘 다 시뮬레이터에서는 됐는데 실기기에서
    // 안 됨 — 검증 못 한 부분), 이미 확실히 검증된 getHTML+setContent 조합만으로
    // 이미지 앞뒤에 빈 문단을 직접 박아 넣는다 — 이미지가 문서 맨 앞에 와도 그 위
    // 첫 줄에 커서를 놓을 자리가 항상 있고, 뒤에도 항상 탭해서 이어 쓸 빈 줄이 있다.
    insertImage: async (url: string) => {
      const html = await editor.getHTML()
      const trimmed = html.trim()
      // ⚠️(2026-08-25) 처음엔 기존 내용 끝의 빈 문단을 지우고 다시 붙였는데(중복 방지
      // 의도), 그게 바로 이미지 2장째부터 "이미지 위에는 여전히 글을 쓸 수 없다"는
      // 버그였다 — 1번째 이미지 뒤에 만들어둔 빈 문단(2번째 이미지의 "위 첫 줄"이 될
      // 자리)을 여기서 지워버리고 있었다. 아무것도 지우지 말고 그대로 이어붙인다 —
      // 기존에 이미 있던 빈 문단이 자연스럽게 새 이미지의 윗줄이 된다.
      const before = trimmed === '' ? '<p></p>' : trimmed
      const safeUrl = url.replace(/"/g, '&quot;')
      editor.setContent(`${before}<p><img src="${safeUrl}" /></p><p></p>`)
      // ⚠️(2026-08-25) setContent 만 부르고 끝내면 웹뷰가 통째로 콘텐츠를 새로 그리면서
      // 네이티브 포커스(첫 응답자 상태)를 잃는다 — 그래서 다음 탭부터 키보드가 아예 안
      // 올라오는 사고가 났다(오너 제보: "입력박스를 아무리 눌러도 키보드가 올라오질
      // 않는다"). editor.focus() 는 Tiptap DOM 포커스뿐 아니라 웹뷰
      // requestFocus()(RN WebView 네이티브 포커스 요청)까지 같이 호출해줘서 이게
      // 필요하다(core.ts 확인) — 'end' 로 커서도 방금 넣은 빈 줄 끝으로 옮겨준다.
      editor.focus('end')
    },
    focus: () => editor.focus(),
    // 유튜브·인스타 링크 — 예전엔 본문 바깥 별도 첨부 목록(BoardLinkChips)에만 들어가서
    // "사진은 안에, 링크는 밖에" 로 자리가 갈렸다(오너 지적: "첨부 컨텐츠들은 모두 본문
    // 내부에 넣게 하라고!!"). tentap 은 커서 위치에 임의 콘텐츠를 끼워넣는 커맨드가
    // 없어서(setImage 처럼 전용 노드 커맨드만 있음), 현재 HTML 뒤에 링크 문단을 이어붙여
    // setContent 로 다시 넣는 방식으로 "본문 안"에 들어가게 한다. 첨부 갤러리(썸네일+재생
    // 배지)는 그대로 유지 — 상세페이지에서 그 표시가 따로 필요해서 없애지 않았다.
    insertLinkText: async (url: string) => {
      const html = await editor.getHTML()
      const safeUrl = url.replace(/"/g, '&quot;')
      editor.setContent(`${html}<p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${url}</a></p>`)
      // insertImage 와 같은 이유로 필요 — setContent 후 웹뷰 네이티브 포커스가
      // 빠져서 이후 탭에도 키보드가 안 올라오는 문제를 막는다.
      editor.focus('end')
    },
  }), [editor])

  // 본문 평문(서식 제외)을 부모에 전달 — canSave·글자수 판단용
  const text = useEditorContent(editor, { type: 'text' })
  useEffect(() => { onChangeText?.(text || '') }, [text, onChangeText])
  // editor 인스턴스를 부모에 넘겨 하단 고정 툴바를 그리게 한다.
  // ⚠️(2026-08-25, 진짜 원인) useEditorBridge 가 돌려주는 editor 객체가 렌더마다 새
  // 참조라, 이 effect(의존성 [editor,...])가 매번 다시 돌면서 부모의 setRichEditor(state
  // setter)를 계속 호출 → 부모 리렌더 → 자식 리렌더 → editor 다시 "새 참조" → 또 effect...
  // 로 무한 루프에 빠졌다("Maximum update depth exceeded" — 실기기에서 터치가 완전히
  // 먹통되던 진짜 원인, 시뮬레이터로 재현해서 실제 에러 로그로 확인함). 부모에게는 딱
  // 한 번만 알리면 충분하니(그 이후 editor 참조가 바뀌어도 내부적으로 같은 브릿지를
  // 계속 쓰므로 다시 알릴 필요 없음) ref 로 한 번만 실행되게 막는다.
  const reportedReadyRef = useRef(false)
  useEffect(() => {
    if (reportedReadyRef.current) return
    reportedReadyRef.current = true
    onEditorReady?.(editor)
    onReady?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  const styles = makeStyles(colors)
  return (
    <View style={styles.wrap}>
      {/* ⚠️(2026-08-25) tentap 기본값은 scrollEnabled=false(웹뷰 내부 스크롤 끔) — 페이지
          전체 스크롤 하나로 처리하려던 시도(dynamicHeight)가 두 번 다 실패해서, 박스에
          maxHeight 를 주고(write.tsx richBox) 그 안에서는 웹뷰 자체 스크롤이 동작하게
          켠다. WebView 컴포넌트 표준 기능이라 tentap 내부 로직(dynamicHeight 처럼
          실패한 적 없음)에 기대지 않는다. */}
      <RichText editor={editor} style={styles.rich} scrollEnabled />
    </View>
  )
})

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    wrap: { flex: 1 },
    rich: { flex: 1, backgroundColor: colors.background },
  })
}
