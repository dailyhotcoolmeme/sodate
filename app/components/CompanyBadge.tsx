import React, { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { useColors } from '@/hooks/useColors'

interface Props {
  name: string
  logoUrl?: string | null
}

export default function CompanyBadge({ name, logoUrl }: Props) {
  const colors = useColors()
  const styles = useMemo(() => StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    logo: {
      width: 20,
      height: 20,
      borderRadius: 4,
    },
    logoPlaceholder: {
      width: 20,
      height: 20,
      borderRadius: 4,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoInitial: {
      color: '#fff',
      fontSize: 10,
      fontWeight: '700',
    },
    name: {
      fontSize: 12,
      color: colors.primary,
      fontWeight: '600',
    },
  }), [colors])

  return (
    <View style={styles.container}>
      {logoUrl ? (
        <Image
          source={{ uri: logoUrl }}
          style={styles.logo}
          contentFit="contain"
        />
      ) : (
        <View style={styles.logoPlaceholder}>
          <Text style={styles.logoInitial}>{name[0]}</Text>
        </View>
      )}
      <Text style={styles.name}>{name}</Text>
    </View>
  )
}
