import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { Colors } from '@/constants/colors'

interface Props {
  name: string
  logoUrl?: string | null
}

export default function CompanyBadge({ name, logoUrl }: Props) {
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

const styles = StyleSheet.create({
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
    backgroundColor: Colors.primary,
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
    color: Colors.primary,
    fontWeight: '600',
  },
})
