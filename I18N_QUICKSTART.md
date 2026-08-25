# i18n Quick Start Guide

## For PR Reviewers

### 1. Install Dependencies

```bash
npm install i18next react-i18next expo-localization --legacy-peer-deps
```

Or with Bun:
```bash
bun add i18next react-i18next expo-localization
```

### 2. Build and Run

```bash
# iOS
npm run ios

# Android
npm run android
```

### 3. Quick Test (2 minutes)

1. **Open Profile**: Tap menu icon or profile tab
2. **Find Language**: Scroll to "Preferences" section → "Language"
3. **Open Picker**: Tap "Language" → see English and Español
4. **Switch**: Tap "Español"
5. **Verify**: Profile screen updates to Spanish immediately
6. **Restart**: Close app, reopen → verify still Spanish
7. **Switch Back**: Tap "Idioma" → "English"

### 4. Review Code

**Key files to review:**
- `src/i18n/i18n.ts` - Core implementation (~150 lines)
- `src/components/profile/LanguageSheet.tsx` - UI component (~120 lines)
- `app/(tabs)/profile.tsx` - Updated Profile screen
- `app/_layout.tsx` - i18n initialization

**Translation files:**
- `src/i18n/locales/en.json` - English
- `src/i18n/locales/es.json` - Spanish

### 5. What to Check

✓ **Code Quality**
- Clear, maintainable code
- Follows existing patterns
- Proper TypeScript types
- Good error handling

✓ **Security**
- No secrets in code
- AsyncStorage appropriate for language preference
- No remote fetching of translations
- No XSS vulnerabilities

✓ **Performance**
- Minimal startup time impact
- Instant language switching
- Small bundle size increase

✓ **UX**
- Intuitive language picker
- Immediate visual feedback
- No layout breaks
- Smooth animations

✓ **Documentation**
- Clear README files
- Migration guide for devs
- Testing instructions
- Technical details

## For Developers

### Use Translations in Your Component

```typescript
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();
  
  return (
    <View>
      <Text>{t('profile.settings.myProfile')}</Text>
    </View>
  );
}
```

### Add New Translation Keys

1. Add to `src/i18n/locales/en.json`:
```json
{
  "myScreen": {
    "title": "My Screen"
  }
}
```

2. Add to `src/i18n/locales/es.json`:
```json
{
  "myScreen": {
    "title": "Mi Pantalla"
  }
}
```

3. Use in component:
```typescript
<Text>{t('myScreen.title')}</Text>
```

### Add New Language

1. Create `src/i18n/locales/fr.json`
2. Import in `src/i18n/i18n.ts`
3. Add to `SUPPORTED_LANGUAGES` array
4. Add to `resources` object

See `docs/i18n-implementation.md` for details.

## Common Issues

### Issue: Dependencies Won't Install

**Solution**: Use `--legacy-peer-deps` flag:
```bash
npm install i18next react-i18next expo-localization --legacy-peer-deps
```

### Issue: TypeScript Errors

**Solution**: Ensure `src/i18n/i18next.d.ts` exists and is valid. Restart TypeScript server.

### Issue: Translations Not Showing

**Solution**: 
1. Check translation key exists in JSON file
2. Verify JSON syntax is valid
3. Ensure `useTranslation()` called in component

### Issue: Language Not Persisting

**Solution**: Check AsyncStorage permissions and verify no `clear()` calls during logout.

## Questions?

- **High-level overview**: `I18N_PR_SUMMARY.md`
- **Technical details**: `docs/i18n-implementation.md`
- **Developer guide**: `docs/i18n-migration-guide.md`
- **Testing guide**: `docs/i18n-testing-instructions.md`

## Summary

This PR adds:
- ✅ i18n infrastructure (i18next + react-i18next)
- ✅ Language picker UI in Profile
- ✅ English & Spanish support (Profile screen)
- ✅ Automatic locale detection
- ✅ Persistent language selection
- ✅ Immediate UI updates (no restart)
- ✅ Type-safe translation keys
- ✅ Comprehensive documentation

**Scope**: Foundation + proof of concept  
**Next Steps**: Translate remaining screens incrementally
