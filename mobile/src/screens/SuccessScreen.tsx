/**
 * Success Screen
 *
 * Shows payment confirmation with animation.
 */

import React, { useEffect, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Vibration,
  Platform,
} from 'react-native'
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { RootStackParamList } from '../../App'

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Success'>
type RouteType = RouteProp<RootStackParamList, 'Success'>

export default function SuccessScreen() {
  const navigation = useNavigation<NavigationProp>()
  const route = useRoute<RouteType>()
  const { amountUsd, projectName } = route.params

  // Animations
  const scaleAnim = useRef(new Animated.Value(0)).current
  const opacityAnim = useRef(new Animated.Value(0)).current
  const checkmarkAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    // Haptic feedback
    if (Platform.OS === 'ios') {
      // iOS haptic would use react-native-haptic-feedback
    } else {
      Vibration.vibrate(100)
    }

    // Success animation sequence
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(checkmarkAnim, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.back(1.5)),
        useNativeDriver: true,
      }),
    ]).start()
  }, [scaleAnim, opacityAnim, checkmarkAnim])

  const handleDone = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: 'Home' }],
    })
  }

  return (
    <View style={styles.container}>
      {/* Success Circle */}
      <Animated.View
        style={[
          styles.successCircle,
          {
            transform: [{ scale: scaleAnim }],
            opacity: opacityAnim,
          },
        ]}
      >
        <Animated.Text
          style={[
            styles.checkmark,
            {
              transform: [{ scale: checkmarkAnim }],
            },
          ]}
        >
          ✓
        </Animated.Text>
      </Animated.View>

      {/* Payment Details */}
      <Animated.View style={[styles.details, { opacity: opacityAnim }]}>
        <Text style={styles.successText}>Payment Successful</Text>
        <Text style={styles.amount}>${amountUsd.toFixed(2)}</Text>
        <Text style={styles.merchant}>Paid to {projectName}</Text>
        <Text style={styles.tokenNote}>
          Project tokens have been deposited to your account
        </Text>
      </Animated.View>

      {/* Done Button */}
      <TouchableOpacity style={styles.doneButton} onPress={handleDone}>
        <Text style={styles.doneButtonText}>Done</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  successCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#22c55e',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  checkmark: {
    color: '#fff',
    fontSize: 56,
    fontWeight: '300',
  },
  details: {
    alignItems: 'center',
    marginBottom: 48,
  },
  successText: {
    color: '#22c55e',
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 16,
  },
  amount: {
    color: '#fff',
    fontSize: 48,
    fontWeight: '700',
    marginBottom: 8,
  },
  merchant: {
    color: '#888',
    fontSize: 16,
    marginBottom: 24,
  },
  tokenNote: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  doneButton: {
    backgroundColor: '#333',
    paddingVertical: 16,
    paddingHorizontal: 64,
    borderRadius: 12,
  },
  doneButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
})
