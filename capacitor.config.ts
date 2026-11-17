import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.ceru.music.mobile',
  appName: '澜音',
  webDir: 'dist',
  // Capacitor's Java dispatcher logs methodData in debug builds, including secrets.
  // Application run logs remain available; disable only bridge/framework logging.
  loggingBehavior: 'none',
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
