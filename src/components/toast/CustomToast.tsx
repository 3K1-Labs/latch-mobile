import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { TouchableOpacity } from 'react-native';
import Toast from 'react-native-toast-message';

export type ToastVariant = 'success' | 'error' | 'info' | 'update';

type Props = {
  variant: ToastVariant;
  text1?: string;
  text2?: string;
  actionLabel?: string;
  onAction?: () => void;
};

type VariantStyle = {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  tint: string;
};

function useVariantStyles(): Record<ToastVariant, VariantStyle> {
  const theme = useTheme<Theme>();
  return {
    success: { icon: 'checkmark-circle', color: theme.colors.success600, tint: 'rgba(0,199,53,0.12)' },
    error: { icon: 'alert-circle', color: theme.colors.danger900, tint: 'rgba(254,95,56,0.12)' },
    info: { icon: 'information-circle', color: theme.colors.primary, tint: 'rgba(255,173,0,0.12)' },
    update: { icon: 'arrow-up-circle', color: theme.colors.primary, tint: 'rgba(255,173,0,0.12)' },
  };
}

export default function CustomToast({ variant, text1, text2, actionLabel, onAction }: Props) {
  const theme = useTheme<Theme>();
  const styles = useVariantStyles()[variant];
  const hasAction = Boolean(actionLabel && onAction);

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      paddingVertical="s"
      paddingHorizontal="s"
      borderRadius={16}
      borderWidth={1}
      borderColor="bg800"
      backgroundColor="cardBackground"
      style={{
        // Hug the content instead of a fixed 90% — a short toast ("Copied")
        // shouldn't span the screen. maxWidth still caps long messages, and the
        // text box shrinks rather than grows to fill.
        alignSelf: 'center',
        maxWidth: '90%',
        shadowColor: theme.colors.black,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
        elevation: 6,
      }}
      accessibilityRole="alert"
      accessibilityLabel={[text1, text2].filter(Boolean).join('. ')}
    >
      <Box
        width={40}
        height={40}
        borderRadius={20}
        alignItems="center"
        justifyContent="center"
        style={{ backgroundColor: styles.tint }}
      >
        <Ionicons name={styles.icon} size={24} color={styles.color} />
      </Box>

      <Box marginLeft="s" marginRight="xs" style={{ flexShrink: 1 }}>
        {text1 ? (
          <Text
            style={{ fontFamily: 'SFproSemibold', fontSize: 15, lineHeight: 20 }}
            color="textPrimary"
            numberOfLines={1}
          >
            {text1}
          </Text>
        ) : null}
        {text2 ? (
          <Text variant="p8" color="textSecondary" numberOfLines={2} marginTop="xs">
            {text2}
          </Text>
        ) : null}
      </Box>

      {hasAction ? (
        <TouchableOpacity
          onPress={onAction}
          activeOpacity={0.85}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Box
            backgroundColor="primary"
            borderRadius={20}
            paddingHorizontal="m"
            justifyContent="center"
            alignItems="center"
            style={{ minHeight: 40 }}
          >
            <Text style={{ fontFamily: 'SFproSemibold', fontSize: 13 }} color="black">
              {actionLabel}
            </Text>
          </Box>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={() => Toast.hide()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <Box
            width={28}
            height={28}
            alignItems="center"
            justifyContent="center"
            marginRight="xs"
          >
            <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
          </Box>
        </TouchableOpacity>
      )}
    </Box>
  );
}
