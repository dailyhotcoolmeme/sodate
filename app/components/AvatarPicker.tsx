import React, { useMemo } from 'react'
import { View, Text, StyleSheet, Modal, Pressable, TouchableOpacity, ScrollView } from 'react-native'
import { Image } from 'expo-image'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { AVATARS } from '@/lib/avatars'
import { useAvatarStore } from '@/stores/avatarStore'

/** 프로필 아바타 선택 — 움직이는 thumbs 24종(4열×6줄). 전 서비스 공용, 빈 이미지 없음. */
export default function AvatarPicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { avatarId, setAvatarId } = useAvatarStore()

  const choose = (id: string) => { setAvatarId(id); onClose() }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.card}>
          <Text style={styles.title}>프로필 이미지</Text>
          <Text style={styles.sub}>마음에 드는 프로필을 골라보세요.</Text>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.grid}>
              {AVATARS.map((a) => (
                <TouchableOpacity key={a.id} style={styles.cell} onPress={() => choose(a.id)} activeOpacity={0.7}>
                  <View style={[styles.tile, avatarId === a.id && styles.tileOn]}>
                    <Image source={a.source} style={styles.img} contentFit="cover" />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
          <TouchableOpacity style={styles.done} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.doneText}>완료</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

function makeStyles(colors: AppColors) {
  const GAP = 12
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
    card: { width: '100%', maxWidth: 400, maxHeight: '84%', borderRadius: 18, backgroundColor: colors.surface, padding: 18 },
    title: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
    sub: { fontSize: 12.5, color: colors.textTertiary, marginTop: 2, marginBottom: 12 },
    scroll: { flexGrow: 0 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
    cell: { width: '22%' },
    tile: {
      width: '100%', aspectRatio: 1, borderRadius: 999, overflow: 'hidden',
      borderWidth: 2.5, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceHigh,
    },
    tileOn: { borderColor: colors.primary },
    img: { width: '100%', height: '100%' },
    done: { marginTop: 14, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: colors.primary },
    doneText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  })
}
