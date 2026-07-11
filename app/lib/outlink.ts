import { Linking, Alert } from 'react-native'
import { isAllowedOutlink } from './security'

// 아웃링크(신청하기·업체사이트·인스타·알림)는 인앱 브라우저가 아니라
// 외부 브라우저(크롬·사파리·삼성인터넷 등)에서 새 창(별도 앱)으로 연다.
// 호출부는 대부분 await/catch 없이 부르므로, 여기서 실패를 자체 처리한다
// (throw 시 unhandled rejection + 버튼이 조용히 먹통 → 사용자 피드백으로 대체).
export async function openOutlink(url: string): Promise<void> {
  if (!url || !isAllowedOutlink(url)) {
    Alert.alert('링크를 열 수 없습니다', '잠시 후 다시 시도해 주세요.')
    return
  }
  try {
    await Linking.openURL(url)
  } catch {
    Alert.alert('링크를 열 수 없습니다', '브라우저를 여는 데 실패했습니다.')
  }
}
