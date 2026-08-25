# i18n Migration Guide

## For Developers: How to Translate Existing Screens

This guide walks through the process of adding i18n support to screens that currently have hardcoded English strings.

## Step-by-Step Process

### 1. Install Dependencies (if not already done)

```bash
npm install i18next react-i18next expo-localization --legacy-peer-deps
```

Or with Bun:
```bash
bun add i18next react-i18next expo-localization
```

### 2. Identify Hardcoded Strings

Look for:
- String literals in JSX: `<Text>My Text</Text>`
- String props: `label="My Label"`
- Alert/Toast messages
- Placeholder text
- Validation messages
- Error messages

### 3. Plan Translation Keys

Create a hierarchical structure:

```
screenName.section.item
```

Example for a send token screen:
```
send.header.title
send.form.recipient
send.form.amount
send.button.send
send.button.cancel
```

### 4. Add Translations to Locale Files

Add your keys to **all** locale files:

**`src/i18n/locales/en.json`**
```json
{
  "send": {
    "header": {
      "title": "Send Token"
    },
    "form": {
      "recipient": "Recipient Address",
      "amount": "Amount"
    },
    "button": {
      "send": "Send",
      "cancel": "Cancel"
    }
  }
}
```

**`src/i18n/locales/es.json`**
```json
{
  "send": {
    "header": {
      "title": "Enviar Token"
    },
    "form": {
      "recipient": "Dirección del Destinatario",
      "amount": "Cantidad"
    },
    "button": {
      "send": "Enviar",
      "cancel": "Cancelar"
    }
  }
}
```

### 5. Update the Component

**Before:**
```typescript
import { Text } from 'react-native';

function SendToken() {
  return (
    <View>
      <Text>Send Token</Text>
      <TextInput placeholder="Recipient Address" />
      <Button title="Send" />
    </View>
  );
}
```

**After:**
```typescript
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';

function SendToken() {
  const { t } = useTranslation();
  
  return (
    <View>
      <Text>{t('send.header.title')}</Text>
      <TextInput placeholder={t('send.form.recipient')} />
      <Button title={t('send.button.send')} />
    </View>
  );
}
```

### 6. Handle Dynamic Content

**Interpolation:**
```typescript
// Translation file
{
  "send": {
    "confirmation": "Sending {{amount}} {{token}} to {{recipient}}"
  }
}

// Component
t('send.confirmation', { 
  amount: '100', 
  token: 'XLM', 
  recipient: 'GABC...' 
})
```

**Pluralization:**
```typescript
// Translation file
{
  "send": {
    "recipients": {
      "one": "{{count}} recipient",
      "other": "{{count}} recipients"
    }
  }
}

// Component
t('send.recipients', { count: recipientCount })
```

### 7. Test in All Languages

1. Open the app
2. Go to Profile → Language
3. Switch to each available language
4. Navigate to your newly translated screen
5. Verify:
   - All text is translated
   - Layout doesn't break
   - Text doesn't overflow
   - Special characters display correctly

## Common Patterns

### Pattern 1: Simple Text

```typescript
<Text>{t('key')}</Text>
```

### Pattern 2: Text with Variables

```typescript
<Text>{t('key', { variable: value })}</Text>
```

### Pattern 3: Button Labels

```typescript
<Button title={t('button.label')} />
```

### Pattern 4: Placeholder Text

```typescript
<TextInput placeholder={t('placeholder')} />
```

### Pattern 5: Conditional Text

```typescript
<Text>
  {isSuccess 
    ? t('message.success') 
    : t('message.error')
  }
</Text>
```

### Pattern 6: Lists

```typescript
const items = [
  { label: t('item.first'), value: '1' },
  { label: t('item.second'), value: '2' },
];
```

### Pattern 7: Error Messages

```typescript
try {
  // ...
} catch (error) {
  showToast(t('error.network'));
}
```

### Pattern 8: Form Validation

```typescript
const schema = Yup.object().shape({
  email: Yup.string()
    .email(t('validation.email.invalid'))
    .required(t('validation.email.required')),
});
```

## Migration Checklist

For each screen you're translating:

- [ ] All visible text uses `t()` function
- [ ] All button labels are translated
- [ ] All placeholder text is translated
- [ ] All error messages are translated
- [ ] All success messages are translated
- [ ] All validation messages are translated
- [ ] Keys added to all locale files (en.json, es.json, etc.)
- [ ] Tested in all supported languages
- [ ] Text doesn't overflow or break layout
- [ ] Dynamic content (counts, names) works correctly

## Recommended Translation Order

Prioritize screens by user frequency:

1. **Authentication/Onboarding** - First user experience
2. **Home/Dashboard** - Most frequently viewed
3. **Send/Receive** - Core functionality
4. **Settings/Profile** - Already done ✓
5. **Transaction History** - High visibility
6. **Swap** - Core feature
7. **Account Management** - Moderate frequency
8. **Help/Support** - Lower frequency but important
9. **Error States** - Low frequency but critical

## Best Practices

### DO ✓

- Use descriptive, hierarchical keys
- Keep translations in sync across all locale files
- Use the `common` namespace for reusable strings
- Test with actual content length in each language
- Consider text expansion (German/French text is ~30% longer than English)
- Use interpolation for dynamic content
- Group related keys together

### DON'T ✗

- Don't hardcode strings
- Don't put HTML/JSX in translation strings
- Don't concatenate translated strings
- Don't use generic keys like `text1`, `text2`
- Don't forget to update all locale files
- Don't translate technical terms (e.g., "blockchain", "XLM")
- Don't assume English text length

## Translation Tips

### Handling Long Text

Some languages require more space than English:

```json
{
  "en": {
    "button": "Send"
  },
  "de": {
    "button": "Senden" // Still fits
  },
  "es": {
    "button": "Enviar" // Still fits
  }
}
```

Design UI to accommodate ~30% text expansion.

### Technical Terms

Some terms should NOT be translated:
- Product names: "Latch"
- Cryptocurrency tickers: "XLM", "USDC"
- Blockchain terms: "mainnet", "testnet"
- Protocol names: "Stellar"

Use as-is across all languages:
```json
{
  "en": {
    "network": "Connected to Stellar mainnet"
  },
  "es": {
    "network": "Conectado a Stellar mainnet"
  }
}
```

### Context Matters

The same English word may translate differently based on context:

- "Address" (location) vs "Address" (wallet address)
- "Transaction" (action) vs "Transaction" (noun)
- "Send" (button) vs "Sending" (status)

Create separate keys when context matters.

## Troubleshooting

### Translation Not Showing

1. Check the key exists in the active locale file
2. Verify the key path is correct (case-sensitive)
3. Ensure `useTranslation()` is called in the component
4. Check browser/dev tools console for i18next warnings

### Layout Breaks

1. Test with longest translated strings
2. Use `numberOfLines` and `ellipsizeMode` on Text components
3. Make containers flexible (avoid fixed widths)
4. Test on small screens

### Missing Translations

i18next will show the key path if a translation is missing:
```
"profile.settings.missing"
```

This makes it obvious what needs translation.

## Getting Help

- Review the [i18n implementation docs](./i18n-implementation.md)
- Check existing translated screens for patterns
- Test in the Profile screen (fully translated example)
- Ask the team for translation reviews

## Example: Complete Screen Migration

See `app/(tabs)/profile.tsx` for a complete example of a fully translated screen.
