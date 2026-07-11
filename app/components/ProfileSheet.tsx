import { useEffect, useState } from 'react'
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Keyboard,
  Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '@/hooks/useColors'
import { useProfileStore } from '@/stores/profileStore'
import { useProfileSheetStore } from '@/stores/profileSheetStore'

/**
 * 내 나이/성별 설정 바텀시트 — 전역 마운트(_layout).
 * TopBar '내 정보'를 어느 화면에서 눌러도 그 자리에서 열린다(홈 이동 불필요).
 */
export default function ProfileSheet() {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const { myAge, myGender, setMyAge, setMyGender } = useProfileStore()
  const open = useProfileSheetStore((s) => s.open)
  const close = useProfileSheetStore((s) => s.closeSheet)
  const [ageInput, setAgeInput] = useState(myAge ? String(myAge) : '')
  // 키보드 높이만큼 시트를 올려 입력칸 가림 방지
  const [kb, setKb] = useState(0)

  // 열릴 때 현재 저장값으로 입력칸 동기화
  useEffect(() => {
    if (open) setAgeInput(myAge ? String(myAge) : '')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) {
      setKb(0)
      return
    }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const s = Keyboard.addListener(showEvt, (e) => setKb(e.endCoordinates.height))
    const h = Keyboard.addListener(hideEvt, () => setKb(0))
    return () => {
      s.remove()
      h.remove()
    }
  }, [open])

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <TouchableOpacity
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        activeOpacity={1}
        onPress={close}
      >
        <View
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 24,
            paddingBottom: insets.bottom + 24,
            marginBottom: kb,
            gap: 20,
          }}
          onStartShouldSetResponder={() => true}
        >
          {/* 핸들 */}
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />

          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.textPrimary }}>내 정보 설정</Text>
          <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: -12 }}>
            설정하면 나에게 맞는 이벤트만 보여드려요
          </Text>

          {/* 나이 입력 */}
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>내 나이</Text>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TextInput
                style={{
                  flex: 1,
                  backgroundColor: colors.surfaceHigh,
                  borderRadius: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  fontSize: 16,
                  color: colors.textPrimary,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
                placeholder="나이 입력 (예: 28)"
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
                value={ageInput}
                onChangeText={setAgeInput}
                maxLength={2}
              />
              {myAge !== null && (
                <TouchableOpacity
                  onPress={() => { setAgeInput(''); setMyAge(null) }}
                  style={{ paddingHorizontal: 12, paddingVertical: 8 }}
                >
                  <Text style={{ fontSize: 13, color: colors.error }}>초기화</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* 성별 선택 */}
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>성별</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {(['male', 'female'] as const).map((g) => (
                <TouchableOpacity
                  key={g}
                  onPress={() => setMyGender(myGender === g ? null : g)}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 10,
                    alignItems: 'center',
                    borderWidth: 1.5,
                    borderColor: myGender === g ? colors.primary : colors.border,
                    backgroundColor: myGender === g ? colors.primary + '22' : colors.surfaceHigh,
                  }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '700', color: myGender === g ? colors.primary : colors.textSecondary }}>
                    {g === 'male' ? '남성' : '여성'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* 저장 버튼 */}
          <TouchableOpacity
            style={{
              backgroundColor: colors.primary,
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: 'center',
            }}
            onPress={() => {
              const age = parseInt(ageInput, 10)
              setMyAge(!isNaN(age) && age > 0 && age < 100 ? age : null)
              close()
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>저장</Text>
          </TouchableOpacity>

          {/* 적용 중 표시 */}
          {(myAge !== null || myGender !== null) && (
            <Text style={{ fontSize: 12, color: colors.secondary, textAlign: 'center', marginTop: -8 }}>
              {[myAge !== null ? `${myAge}세` : '', myGender ? (myGender === 'male' ? '남성' : '여성') : ''].filter(Boolean).join(' · ')} 기준으로 필터링 중
            </Text>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  )
}
