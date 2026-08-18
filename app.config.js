import { existsSync } from 'fs';
import env from './env';
import packageJson from './package.json';

const epochTimeInSeconds = Math.round(Date.now() / 1000);
const versionCode = epochTimeInSeconds;
const buildNumber = String(epochTimeInSeconds);
const buildVersion = packageJson.version;
const appName = env.APP_NAME;
const sentry = env.SENTRY_AUTH_TOKEN;

export default {
  expo: {
    owner: 'frankiepower',
    name: appName === 'Latch' ? 'Latch' : 'Latch QA',
    slug: 'latch-mobile',
    version: buildVersion,
    orientation: 'portrait',
    icon: appName === 'Latch' ? './assets/images/icon.png' : './assets/images/iconStaging.png',
    // 'wc' lets Latch be offered as a handler for raw WalletConnect URIs
    // (e.g. a wc: link shared outside of a QR code) in addition to its own latch:// scheme.
    scheme: ['latch', 'wc'],
    userInterfaceStyle: 'automatic',
    splash: {
      // image: './assets/images/icon.png',
      // resizeMode: 'cover',
      backgroundColor: '#121212',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: appName === 'Latch' ? 'co.getlatch.latchapp' : 'qa.getlatch.app',
      appleTeamId: 'P5QF5H77W5',
      ...(process.env.GOOGLE_SERVICES_IOS || existsSync('./GoogleService-Info.plist')
        ? { googleServicesFile: process.env.GOOGLE_SERVICES_IOS ?? './GoogleService-Info.plist' }
        : {}),
      buildNumber,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSFaceIDUsageDescription: 'Allow $(PRODUCT_NAME) to use FaceID for secure access.',
        // Allow outbound HTTPS to Stellar RPC + Horizon endpoints.
        // ATS by default requires forward-secrecy ciphers; some Stellar infrastructure
        // doesn't advertise them, causing xhr.onerror at the TLS handshake stage.
        NSAppTransportSecurity: {
          NSExceptionDomains: {
            'stellar.org': {
              NSIncludesSubdomains: true,
              NSExceptionAllowsInsecureHTTPLoads: false,
              NSExceptionRequiresForwardSecrecy: false,
              NSExceptionMinimumTLSVersion: 'TLSv1.2',
            },
          },
        },
      },
    },
    android: {
      versionCode,
      usescleartexttraffic: true, // Allow outbound HTTP to local dev servers; testnet RPCs should be HTTPS and won't be affected.
      package: appName === 'Latch' ? 'app.getlatch.app' : 'qa.getlatch.app',
      adaptiveIcon: {
        backgroundColor: '#000000',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      ...(process.env.GOOGLE_SERVICES_ANDROID || existsSync('./google-services.json')
        ? { googleServicesFile: process.env.GOOGLE_SERVICES_ANDROID ?? './google-services.json' }
        : {}),
      permissions: [
        'android.permission.USE_BIOMETRIC',
        'android.permission.USE_FINGERPRINT',
        'android.permission.CAMERA',
        'android.permission.POST_NOTIFICATIONS',
      ],
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      './plugins/withJitpackContentFilter',
      'expo-router',
      'expo-notifications',
      '@react-native-community/datetimepicker',
      'expo-image',
      [
        'expo-splash-screen',
        {
          // 1x1 transparent image: keeps a logo-less dark splash while still
          // generating the splashscreen_logo drawable that Theme.App.SplashScreen
          // hard-references, so AAPT2 release resource linking succeeds.
          image: './assets/images/splash-transparent.png',
          imageWidth: 48,
          resizeMode: 'contain',
          backgroundColor: '#121212',
          dark: {
            image: './assets/images/splash-transparent.png',
            backgroundColor: '#121212',
          },
        },
      ],
      [
        'expo-font',
        {
          fonts: [
            './assets/fonts/SFPRO-Thin.ttf',
            './assets/fonts/SFPRO-Regular.ttf',
            './assets/fonts/SFPRO-Medium.ttf',
            './assets/fonts/SFPRO-bold.ttf',
            './assets/fonts/SFPRO-Semibolditalic.otf',
            './assets/fonts/SFProRounded-Medium.ttf',
            './assets/fonts/SFProRounded-Bold.ttf',
          ],
        },
      ],
      // [
      //   '@hot-updater/react-native',
      //   {
      //     channel: env.EXPO_PUBLIC_APP_ENV,
      //   },
      // ],
      [
        'expo-camera',
        {
          cameraPermission: 'Allow $(PRODUCT_NAME) to access your camera',
          barcodeScannerEnabled: true,
        },
      ],
      // [
      //   '@hot-updater/react-native',
      //   {
      //     channel: env.EXPO_PUBLIC_APP_ENV,
      //   },
      // ],
      [
        'expo-build-properties',
        {
          android: {
            compileSdkVersion: 36,
            targetSdkVersion: 35,
            buildToolsVersion: '36.0.0',
            gradlePluginVersion: '8.9.1',
            ndk: '27.1.12297006',
            networkInspector: false,
          },
        },
      ],
      ...(sentry
        ? [
            [
              '@sentry/react-native/expo',
              {
                url: 'https://sentry.io/',
                authToken: sentry,
                project: 'latch-mobile',
                organization: 'latch',
              },
            ],
          ]
        : []),
    ],
    updates: {
      url: 'https://u.expo.dev/8b122713-0d94-4940-a71c-58da86f923ad',
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      otaCritical: true,
      eas: {
        projectId: '8b122713-0d94-4940-a71c-58da86f923ad',
      },
    },
  },
};
