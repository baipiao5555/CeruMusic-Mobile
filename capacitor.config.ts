import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.ceru.music.mobile',
  appName: '澜音',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
    backgroundColor: '#eef7f3'
  },
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#eef7f3',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP'
    }
  }
}

export default config
