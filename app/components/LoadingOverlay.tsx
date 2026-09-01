import React from 'react'
import { Modal, View, Text, StyleSheet } from 'react-native'
import AppSpinner from '@/components/AppSpinner'

interface Props {
  visible: boolean
  // 여러 장 업로드처럼 "몇 번째 하는 중"을 알려줘야 기다릴 만할 때만 넘긴다(오너 지시:
  // "스피너에 몇번째장 첨부중인지 1/5.. 2/5.. 숫자로 표시해줘라. 그래야 인내하고
  // 기다릴 수 있다") — 안 넘기면 기존과 동일하게 스피너만 보인다.
  message?: string
}

/**
 * 화면 전체 중앙 로딩 오버레이 — 저장/제출 등 버튼 액션 처리 중 표시.
 * 버튼 내부가 아니라 화면 전체 딤 + 중앙 스피너(바텀시트 위까지 덮음).
 */
export default function LoadingOverlay({ visible, message }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <AppSpinner size={48} />
        {!!message && <Text style={styles.message}>{message}</Text>}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  message: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
})
