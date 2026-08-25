import React from 'react'
import { UIManager } from 'react-native'

/**
 * 리치에디터 툴바(tentap Toolbar). 입력칸 상단에 고정으로 그린다(2026-08-25 —
 * 키보드 위에 띄우던 KeyboardStickyView 방식은 실제 키보드 애니메이션 상태에
 * 의존해서 검증이 불가능했고 실기기 회귀까지 냈다 → 폐기).
 * tentap Toolbar 는 기본적으로 `!isKeyboardUp || !isFocused` 면 자체적으로
 * 숨긴다(내부 useKeyboard 훅) — 상단 고정이라 키보드 상태와 무관하게 항상
 * 보여야 하므로 hidden={false} 로 그 내부 로직을 무시시킨다.
 * webview 없으면 아무것도 안 그린다.
 */
const RICH_EDITOR_AVAILABLE = !!UIManager.getViewManagerConfig?.('RNCWebView')

let ToolbarImpl: any = null
if (RICH_EDITOR_AVAILABLE) {
  ToolbarImpl = require('@10play/tentap-editor').Toolbar
}

export default function BoardRichToolbar({ editor, items }: { editor: unknown; items?: unknown[] }) {
  if (!ToolbarImpl || !editor) return null
  return <ToolbarImpl editor={editor} items={items} hidden={false} />
}
