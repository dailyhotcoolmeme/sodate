import { TouchableOpacity, Text, StyleSheet, Animated } from 'react-native'
import { useRef } from 'react'
import { Colors } from '@/constants/colors'

interface Props {
  isFavorite: boolean
  onToggle: () => void
  size?: 'sm' | 'md' | 'lg'
}

export default function FavoriteButton({ isFavorite, onToggle, size = 'md' }: Props) {
  const scale = useRef(new Animated.Value(1)).current

  const handlePress = () => {
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.35, useNativeDriver: true, speed: 50 }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20 }),
    ]).start()
    onToggle()
  }

  const iconSize = size === 'sm' ? 16 : size === 'lg' ? 26 : 20
  const padH = size === 'sm' ? 6 : size === 'lg' ? 12 : 8
  const padV = size === 'sm' ? 4 : size === 'lg' ? 10 : 6

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      style={[
        styles.btn,
        { paddingHorizontal: padH, paddingVertical: padV },
        isFavorite && styles.btnActive,
      ]}
    >
      <Animated.Text style={[{ fontSize: iconSize }, { transform: [{ scale }] }]}>
        {isFavorite ? '♥' : '♡'}
      </Animated.Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnActive: {
    borderColor: '#FF6B9D',
    backgroundColor: '#FF6B9D18',
  },
})
