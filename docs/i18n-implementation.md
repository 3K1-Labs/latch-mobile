# Internationalization (i18n) Implementation

## Overview

The Latch mobile app now includes internationalization support using `i18next`, `react-i18next`, and `expo-localization`. The infrastructure allows the app to be displayed in multiple languages with language selection persisting across app restarts.

## Architecture

### Core Libraries

- **i18next**: Core i18n framework
- **react-i18next**: React bindings for i18next
- **expo-localization**: Device locale detection

### File Structure

```
src/i18n/
├── i18n.ts              # i18n initialization and configuration
├── i18next.d.ts         # TypeScript type definitions
└── locales/
    ├── en.json          # English translations
    └── es.json          # Spanish translations (proof of concept)
```

### Key Files

#### `src/i18n/i18n.ts`

Contains:
- i18n initialization logic
- Language persistence (AsyncStorage)
- Device locale detection fallback
- Language switching functionality
- List of supported languages

#### Translation Files

JSON files under `src/i18n/locales/` contain key-value pairs for translated strings:

```json
{
  "profile": {
    "settings": {
      "myProfile": "My Profile"
    }
  }
}
```

## Usage

### In Components

```typescript
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();
  
  return <Text>{t('profile.settings.myProfile')}</Text>;
}
```

### Type Safety

TypeScript provides autocomplete and type checking for translation keys based on the English locale file (`en.json`).

### Changing Language

Users can change the language from the Profile screen:

1. Navigate to Profile
2. Tap "Language" in the Preferences section
3. Select desired language from the list

The selection persists across app restarts.

## Current Translation Coverage

### Fully Translated Screens

- **Profile screen** (`app/(tabs)/profile.tsx`):
  - All section headers (Account, Security, Preferences, Support)
  - All setting items
  - Logout confirmation

### Not Yet Translated

The following areas still contain hardcoded English strings:

- Onboarding flows
- Transaction screens
- Swap interface
- Account management
- Notifications
- Error messages
- Form validation messages
- Toast messages
- All other screens not explicitly listed above

## Adding New Languages

1. Create a new JSON file in `src/i18n/locales/` (e.g., `fr.json` for French)
2. Copy the structure from `en.json` and translate all values
3. Import the translations in `src/i18n/i18n.ts`:
   ```typescript
   import fr from './locales/fr.json';
   ```
4. Add the resource:
   ```typescript
   const resources = {
     en: { translation: en },
     es: { translation: es },
     fr: { translation: fr }, // Add here
   };
   ```
5. Add to supported languages list:
   ```typescript
   export const SUPPORTED_LANGUAGES = [
     { code: 'en', name: 'English', nativeName: 'English' },
     { code: 'es', name: 'Spanish', nativeName: 'Español' },
     { code: 'fr', name: 'French', nativeName: 'Français' }, // Add here
   ] as const;
   ```

## Translating Additional Screens

### Process

1. **Extract hardcoded strings** from the component
2. **Add translation keys** to all locale JSON files
3. **Replace strings** with `t()` calls:
   ```typescript
   // Before:
   <Text>My Profile</Text>
   
   // After:
   <Text>{t('profile.settings.myProfile')}</Text>
   ```
4. **Import useTranslation** at the top of the component:
   ```typescript
   import { useTranslation } from 'react-i18next';
   
   function MyComponent() {
     const { t } = useTranslation();
     // ...
   }
   ```

### Naming Conventions

Use dot-separated hierarchical keys reflecting the UI structure:

```
screen.section.item
```

Examples:
- `profile.settings.myProfile`
- `onboarding.createWallet.title`
- `send.confirmTransaction.button`

### Common Keys

Place commonly reused strings in the `common` namespace:

```json
{
  "common": {
    "ok": "OK",
    "cancel": "Cancel",
    "save": "Save"
  }
}
```

## Implementation Notes

### No Restart Required

Language changes apply immediately throughout the app without requiring a restart. This is achieved through React's state management and i18next's reactive bindings.

### Persistence

The selected language is stored in AsyncStorage under the key `latch_selected_language` and automatically restored on app launch.

### Fallback Behavior

1. User's explicitly selected language (if any)
2. Device system language (if supported)
3. English (default fallback)

### Device Locale Detection

On first launch, the app detects the device locale using `expo-localization` and automatically selects a matching language if available.

## Testing

### Manual Testing Checklist

- [ ] Language picker shows all supported languages
- [ ] Switching language updates UI immediately
- [ ] Selected language persists after app restart
- [ ] Device locale is respected on first launch
- [ ] All translated screens display correctly in all languages
- [ ] Text wrapping and layout work for all languages

### Testing Different Locales

1. Change device language in system settings
2. Delete and reinstall the app
3. Verify the app launches in the correct language

## Future Enhancements

### Recommended Next Steps

1. **Extract all remaining strings** across the app
2. **Add more languages** based on user demographics
3. **Implement pluralization** for count-based strings
4. **Add date/time formatting** using locale-specific formats
5. **Implement RTL support** for right-to-left languages (Arabic, Hebrew)
6. **Add translation management** tools for non-technical team members
7. **Implement automated tests** for translation completeness

### Pluralization Example

```json
{
  "items": {
    "one": "{{count}} item",
    "other": "{{count}} items"
  }
}
```

```typescript
t('items', { count: 1 })  // "1 item"
t('items', { count: 5 })  // "5 items"
```

### Interpolation Example

```json
{
  "welcome": "Welcome, {{name}}!"
}
```

```typescript
t('welcome', { name: 'Alice' })  // "Welcome, Alice!"
```

## Security Considerations

- Translation files are bundled with the app (not fetched remotely)
- No user-generated content is stored in translation files
- Language preference is stored in AsyncStorage (not SecureStore) as it's not sensitive

## References

- [i18next Documentation](https://www.i18next.com/)
- [react-i18next Documentation](https://react.i18next.com/)
- [expo-localization Documentation](https://docs.expo.dev/versions/latest/sdk/localization/)
