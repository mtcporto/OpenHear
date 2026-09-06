import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.openhear.app',
  appName: 'OpenHear',
  webDir: 'out',
  server: {
    androidScheme: 'https',
  },
};

export default config;
