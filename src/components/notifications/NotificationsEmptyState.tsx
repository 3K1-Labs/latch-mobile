import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { Dimensions } from 'react-native';

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

const height = Dimensions.get('window').height;

const NotificationsEmptyState = () => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();

  return (
    <Box
      height={height / 2}
      justifyContent="center"
      alignItems="center"
      paddingHorizontal="xl"
    >
      <Box
        width={64}
        height={64}
        borderRadius={32}
        backgroundColor={isDark ? 'gray900' : 'gray100'}
        justifyContent="center"
        alignItems="center"
        mb="m"
      >
        <Ionicons name="notifications-outline" size={28} color={theme.colors.textSecondary} />
      </Box>
      <Text variant="h10" color="textPrimary" fontWeight="700" textAlign="center" mb="xs">
        No notifications yet
      </Text>
      <Text variant="p8" color="textSecondary" textAlign="center">
        Activity on your account will appear here.
      </Text>
    </Box>
  );
};

export default NotificationsEmptyState;
