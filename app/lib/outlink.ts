import * as WebBrowser from 'expo-web-browser'
import { isAllowedOutlink } from './security'

export async function openOutlink(url: string): Promise<void> {
  if (!isAllowedOutlink(url)) {
    throw new Error('허용되지 않은 아웃링크 URL')
  }
  await WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    toolbarColor: '#0F0F0F',
    controlsColor: '#FF6B9D',
    showTitle: true,
  })
}
