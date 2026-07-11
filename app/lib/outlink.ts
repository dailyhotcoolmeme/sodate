import { Linking } from 'react-native'
import { isAllowedOutlink } from './security'

// 아웃링크(신청하기·업체사이트·인스타·알림)는 인앱 브라우저가 아니라
// 외부 브라우저(크롬·사파리·삼성인터넷 등)에서 새 창(별도 앱)으로 연다.
export async function openOutlink(url: string): Promise<void> {
  if (!isAllowedOutlink(url)) {
    throw new Error('허용되지 않은 아웃링크 URL')
  }
  await Linking.openURL(url)
}
