# i18n Testing Instructions

## Prerequisites

Before testing, ensure the required dependencies are installed:

```bash
npm install i18next react-i18next expo-localization --legacy-peer-deps
```

Or with Bun:
```bash
bun add i18next react-i18next expo-localization
```

## Manual Testing Checklist

### 1. First Launch (Fresh Install)

**Test Device Locale Detection:**

1. Set your device language to English
2. Delete the app completely (if already installed)
3. Rebuild and install: `npm run ios` or `npm run android`
4. Complete onboarding
5. Navigate to Profile
6. **Expected**: App UI is in English

**Repeat with Spanish:**

1. Set device language to Spanish (Español)
2. Delete the app
3. Rebuild and install
4. Complete onboarding
5. Navigate to Profile
6. **Expected**: Profile screen shows Spanish translations

**Repeat with Unsupported Language:**

1. Set device to an unsupported language (e.g., French, Japanese)
2. Delete the app
3. Rebuild and install
4. Complete onboarding
5. Navigate to Profile
6. **Expected**: App defaults to English

### 2. Language Picker Functionality

**Access Language Settings:**

1. Open the app
2. Navigate to Profile (tap menu icon or profile tab)
3. Scroll to "Preferences" section
4. **Expected**: "Language" setting is visible with current language shown (e.g., "English" or "Español")

**Open Language Sheet:**

1. Tap on "Language" setting
2. **Expected**: Bottom sheet slides up showing list of languages

**Language List Display:**

1. Review the language list
2. **Expected**: 
   - English and Spanish both visible
   - Each language shown in native script (English, Español)
   - Sub-text shows English name
   - Current language has checkmark
   - Close button (X) in top-right

**Switch Language:**

1. Tap on Spanish (Español)
2. **Expected**:
   - Sheet closes automatically after ~300ms
   - Profile screen immediately updates to Spanish
   - All visible text changes:
     - Section headers (Cuenta, Seguridad, Preferencias, Soporte)
     - Setting items (Mi Perfil, Mis Cuentas, etc.)
     - Network value changes appropriately

**Switch Back:**

1. Tap "Idioma" (Language in Spanish)
2. Tap "English"
3. **Expected**: Profile returns to English immediately

### 3. Persistence Testing

**Test Across App Restarts:**

1. Switch to Spanish
2. Close the app completely (swipe away from app switcher)
3. Reopen the app
4. Navigate to Profile
5. **Expected**: App is still in Spanish

**Test Across Native Rebuilds:**

1. Switch to Spanish
2. Stop the app
3. Rebuild and reinstall: `npm run ios` or `npm run android`
4. **Expected**: App launches in Spanish

### 4. UI/Layout Testing

**Test Text Overflow:**

1. Switch between English and Spanish multiple times
2. Check each section of Profile:
   - Account section
   - Security section
   - Preferences section
   - Support section
3. **Expected**: 
   - No text cutoff
   - No overlapping text
   - All icons properly aligned
   - Setting rows height adjusts correctly

**Test on Small Screens:**

1. If testing on a large device, try rotating to landscape
2. Or test on a smaller device (iPhone SE, small Android)
3. Switch languages
4. **Expected**: Layout remains correct, no overflow

**Test Long Content:**

1. Look at "Multisig Wallets" / "Carteras Multifirma"
2. Look at "Approve a Request" / "Aprobar una Solicitud"
3. **Expected**: Longer Spanish text fits without issues

### 5. Edge Cases

**Rapid Switching:**

1. Open language picker
2. Quickly tap different languages multiple times
3. **Expected**: 
   - No crashes
   - Sheet doesn't get stuck
   - Latest selection is respected

**Sheet Dismissal:**

1. Open language picker
2. Tap close button (X)
3. **Expected**: Sheet closes without changing language

**Background Dismissal:**

1. Open language picker
2. Tap outside the sheet (on backdrop)
3. **Expected**: Sheet closes without changing language

**Language Change Mid-Navigation:**

1. Navigate to Profile
2. Switch to Spanish
3. Navigate to another tab (Home, History, etc.)
4. Return to Profile
5. **Expected**: Profile still in Spanish

### 6. Integration with Existing Features

**Network Setting:**

1. Switch to Spanish
2. Check Network setting value
3. **Expected**: Shows "Red de Prueba" or "Red Pública" (not English)

**About Version:**

1. Switch to Spanish
2. Check "About Latch" value
3. **Expected**: Version "v1.0.0" remains (not translated)

**Other Sheets:**

1. Switch to Spanish
2. Open other profile sheets (Address Book, Help, etc.)
3. **Expected**: These sheets still show English (not yet translated)

### 7. Error Handling

**Missing Translations:**

1. Switch to Spanish
2. Navigate through the app
3. Look for any screens showing key paths (e.g., "profile.settings.missing")
4. **Expected**: Only Profile screen is translated; others show English

**Storage Errors:**

1. With app in Spanish, use dev tools to clear AsyncStorage
2. Restart app
3. **Expected**: App detects device locale again (or defaults to English)

## Automated Testing (Future)

Once automated tests are added, verify:

```bash
npm run test
```

Should include:
- [ ] i18n initialization tests
- [ ] Language switching tests
- [ ] Persistence tests
- [ ] Translation key validation tests

## Known Issues to Watch For

### Issue: Language Not Persisting

**Symptoms**: Language resets to English after app restart

**Check**:
1. Verify AsyncStorage permissions
2. Check for any AsyncStorage.clear() calls during logout
3. Confirm `latch_selected_language` key exists in AsyncStorage

**Debug**:
```typescript
// Add to app/_layout.tsx temporarily
import AsyncStorage from '@react-native-async-storage/async-storage';
AsyncStorage.getItem('latch_selected_language').then(console.log);
```

### Issue: Translations Not Showing

**Symptoms**: Seeing translation keys instead of actual text (e.g., "profile.settings.myProfile")

**Check**:
1. Verify locale JSON files are in correct location
2. Check for syntax errors in JSON files
3. Confirm i18n initialized before components render

**Debug**: Check console for i18next warnings

### Issue: Layout Breaks

**Symptoms**: Text overflows, UI elements misaligned

**Check**:
1. Measure text length in Spanish vs English
2. Check if fixed widths are used
3. Verify flex containers are properly configured

**Fix**: Use flexible layouts, avoid fixed widths

### Issue: App Won't Build

**Symptoms**: Build errors after adding i18n packages

**Check**:
1. Clear node_modules: `rm -rf node_modules`
2. Clear package lock: `rm package-lock.json` or `rm bun.lockb`
3. Reinstall: `npm install --legacy-peer-deps` or `bun install`
4. Clean native builds: `npm run ios --clean` or `npm run android --clean`

## Performance Testing

**Startup Time:**

1. Force quit the app
2. Launch and time until UI is interactive
3. **Expected**: < 200ms additional startup time for i18n init

**Language Switch Time:**

1. Tap a different language
2. Time until UI updates
3. **Expected**: < 500ms total (including 300ms intentional delay)

**Memory Usage:**

1. Monitor memory before/after language switch
2. **Expected**: < 1MB difference (JSON files are small)

## Reporting Issues

If you find issues, include:
- Device type and OS version
- Steps to reproduce
- Expected vs actual behavior
- Screenshots (especially for layout issues)
- Console logs (if applicable)
- Device language setting

## Success Criteria

All tests pass with:
- ✓ No crashes
- ✓ No layout breaks
- ✓ Language persists
- ✓ Translations show correctly
- ✓ Performance acceptable
- ✓ Works on iOS and Android
