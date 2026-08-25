import React from 'react'
import { UIManager } from 'react-native'

/**
 * 리치에디터 하단 고정 툴바(tentap Toolbar). 키보드 위에 붙이려고 에디터 본체와 분리해
 * 화면 최하단(KeyboardStickyView) 에서 그린다. webview 없으면 아무것도 안 그린다.
 */
const RICH_EDITOR_AVAILABLE = !!UIManager.getViewManagerConfig?.('RNCWebView')

let ToolbarImpl: any = null
if (RICH_EDITOR_AVAILABLE) {
  ToolbarImpl = require('@10play/tentap-editor').Toolbar
}

export default function BoardRichToolbar({ editor, items }: { editor: unknown; items?: unknown[] }) {
  if (!ToolbarImpl || !editor) return null
  return <ToolbarImpl editor={editor} items={items} />
}
