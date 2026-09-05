import { existsSync } from 'fs';
import env from './env';
import packageJson from './package.json';

const epochTimeInSeconds = Math.round(Date.now() / 1000);
const versionCode = epochTimeInSeconds;
const buildNumber = String(epochTimeInSeconds);
const buildVersion = packageJson.version;
const appName = env.APP_NAME;
const sentry = env.SENTRY_AUTH_TOKEN;
// Must match PASSKEY_RP_ID in src/constants/config.ts — the associated domain
// is how iOS proves this app is authorized to create/use passkeys scoped to
// that relying party (ASAuthorizationPlatformPublicKeyCredentialProvider).
// Requires a `.well-known/apple-app-site-association` file with a
// `webcredentials` entry for this app served from that domain (backend/infra
// change, outside this repo).
// Normalised the same way as normalizePasskeyRpId in
// src/lib/passkey-rp-id.ts — an RP ID configured as a URL would produce
// `webcredentials:https://example.com`, which iOS cannot parse.
const passkeyRpId = (env.EXPO_PUBLIC_PASSKEY_RP_ID || 'uselatch.app')
  .trim()
  .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  .replace(/\/.*$/, '');

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
      bundleIdentifier: 'co.getlatch.latchapp',
      appleTeamId: 'P5QF5H77W5',
      associatedDomains: [`webcredentials:${passkeyRpId}`],
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
      // expo-image-picker adds the legacy storage permissions by default, which
      // put the app under Google Play's Photo and Video Permissions policy —
      // Play rejects the submission until you declare why a wallet needs the
      // user's whole photo library. It doesn't: the only use is picking an
      // account avatar (AccountInfoSheet, AddAccountInfo), and Android's system
      // photo picker serves that with no permission at all.
      //
      // The cost is Android 12 and below, where there is no photo picker and
      // library access needs READ_EXTERNAL_STORAGE. Avatar selection degrades
      // there; nothing else in the app touches storage.
      //
      // RECORD_AUDIO comes from expo-camera, which requests it because the
      // camera can record video. This app only scans barcodes — CameraView in
      // ScannerFrame, ScanQRSheet and pair-show-qr, with no recordAsync and no
      // video mode anywhere — so a microphone permission on a wallet is dead
      // weight that reviewers and users both have to wonder about.
      //
      // READ_MEDIA_IMAGES comes from expo-screen-capture, not the image picker.
      // Its manifest declares the screenshot-DETECTION permissions
      // (READ_MEDIA_IMAGES on API 33, DETECT_SCREEN_CAPTURE on 34+), but
      // use-secure-screen.ts only calls preventScreenCaptureAsync /
      // allowScreenCaptureAsync, which need no permission. It is a photo
      // permission, so leaving it merges it into the AAB from the AAR at Gradle
      // time and Play rejects the submission — which is precisely what happened
      // after the first pass here blocked only the storage permissions.
      blockedPermissions: [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.RECORD_AUDIO',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
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
            // Play rejects an upload whose target API is below the level it
            // required a year earlier ("Target SDK of artifact is too low"),
            // and that floor moved to 36 on 2026-08-31. Pinned rather than left
            // to the Expo default because it is a store deadline, not a
            // preference: it has to move on Google's schedule, and an explicit
            // number is what makes the next bump a visible edit.
            targetSdkVersion: 36,
            buildToolsVersion: '36.0.0',
            gradlePluginVersion: '8.9.1',
            ndk: '27.1.12297006',
            networkInspector: false,
          },
        },
      ],
      // The plugin is added only when a token is available, so a build without
      // one skips source-map upload instead of failing on it.
      //
      // `authToken` and `url` are deliberately NOT passed here. Passing the
      // token inline bakes it into the resolved config (the plugin warns:
      // "Detected unsecure use of 'authToken'"), and setting `url` alongside a
      // token that sentry-cli reads from the environment makes the two come
      // from different configuration sources, which makes sentry-cli discard
      // the URL ("Ignoring a configured URL..."). sentry-cli reads
      // SENTRY_AUTH_TOKEN from the environment on its own, and defaults to
      // sentry.io, so both are better left unset.
      ...(sentry
        ? [
            [
              '@sentry/react-native/expo',
              {
                project: 'latch-mobile',
                organization: 'latch-ha',
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
