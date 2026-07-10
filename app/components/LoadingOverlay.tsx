import React from 'react'
import { Modal, View, StyleSheet } from 'react-native'
import AppSpinner from '@/components/AppSpinner'

interface Props {
  visible: boolean
}

/**
 * 화면 전체 중앙 로딩 오버레이 — 저장/제출 등 버튼 액션 처리 중 표시.
 * 버튼 내부가 아니라 화면 전체 딤 + 중앙 스피너(바텀시트 위까지 덮음).
 */
export default function LoadingOverlay({ visible }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <AppSpinner size={48} />
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
  },
})
