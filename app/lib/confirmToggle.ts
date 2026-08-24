import { Alert } from 'react-native'

/**
 * 찜/스크랩 — 예전엔 하트·북마크를 누르는 즉시 바로 적용됐는데, 실수로 누르는 경우가
 * 있어 담을 때·뺄 때 모두 팝업으로 한 번 더 확인받고 적용한다(2026-08-25 오너 지시:
 * "누르자마자 적용되는데 이것도 팝업으로 확인후에 적용되게 해라").
 */
export function confirmFavorite(isFavorite: boolean, onConfirm: () => void): void {
  if (isFavorite) {
    Alert.alert('찜 해제', '찜 목록에서 뺄까요?', [
      { text: '취소', style: 'cancel' },
      { text: '해제', style: 'destructive', onPress: onConfirm },
    ])
  } else {
    Alert.alert('찜하기', '찜 목록에 담을까요?', [
      { text: '취소', style: 'cancel' },
      { text: '담기', onPress: onConfirm },
    ])
  }
}

export function confirmScrap(isScrapped: boolean, onConfirm: () => void): void {
  if (isScrapped) {
    Alert.alert('스크랩 해제', '스크랩을 해제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '해제', style: 'destructive', onPress: onConfirm },
    ])
  } else {
    Alert.alert('스크랩', '이 글을 스크랩할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '스크랩', onPress: onConfirm },
    ])
  }
}
