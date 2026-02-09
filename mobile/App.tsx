/**
 * PayTerm Mobile App
 *
 * Native iOS/Android app for paying at Juicebox terminals.
 * Supports NFC tap-to-pay and deep linking.
 */

import React, { useEffect } from 'react'
import { StatusBar, Linking, Alert } from 'react-native'
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import NfcManager from 'react-native-nfc-manager'

import HomeScreen from './src/screens/HomeScreen'
import PaymentScreen from './src/screens/PaymentScreen'
import SuccessScreen from './src/screens/SuccessScreen'
import SettingsScreen from './src/screens/SettingsScreen'
import { useAuthStore } from './src/stores/authStore'

export type RootStackParamList = {
  Home: undefined
  Payment: { sessionId: string }
  Success: { amountUsd: number; projectName: string }
  Settings: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()

// Deep link configuration
const linking = {
  prefixes: [
    'payterm://',
    'https://pay.juicyvision.app',
    'https://juicyvision.app',
  ],
  config: {
    screens: {
      Payment: {
        path: 's/:sessionId',
        parse: {
          sessionId: (sessionId: string) => sessionId,
        },
      },
      Home: '*',
    },
  },
}

function App(): React.JSX.Element {
  const navigationRef = useNavigationContainerRef<RootStackParamList>()
  const { initialize } = useAuthStore()

  // Initialize NFC and auth on app start
  useEffect(() => {
    const init = async () => {
      // Initialize auth store
      await initialize()

      // Check NFC support
      const supported = await NfcManager.isSupported()
      if (supported) {
        await NfcManager.start()
      }
    }

    init()

    return () => {
      NfcManager.cancelTechnologyRequest().catch(() => {})
    }
  }, [initialize])

  // Handle incoming deep links when app is already running
  useEffect(() => {
    const handleUrl = (event: { url: string }) => {
      const url = event.url
      console.log('Deep link received:', url)

      // Extract session ID from URL
      const sessionMatch = url.match(/\/s\/([a-f0-9-]+)/i)
      if (sessionMatch && navigationRef.current) {
        navigationRef.current.navigate('Payment', { sessionId: sessionMatch[1] })
      }
    }

    const subscription = Linking.addEventListener('url', handleUrl)

    // Check if app was opened via deep link
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleUrl({ url })
      }
    })

    return () => {
      subscription.remove()
    }
  }, [navigationRef])

  return (
    <NavigationContainer ref={navigationRef} linking={linking}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: { backgroundColor: '#1a1a1a' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: '#1a1a1a' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: 'PayTerm', headerShown: false }}
        />
        <Stack.Screen
          name="Payment"
          component={PaymentScreen}
          options={{ title: 'Pay', headerBackTitle: 'Cancel' }}
        />
        <Stack.Screen
          name="Success"
          component={SuccessScreen}
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: 'Settings' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  )
}

export default App
