import { TouchableOpacity } from 'react-native';

import type { AppNotification } from '@/src/api/notifications';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { formatRelativeTime } from '@/src/utils';

interface Props {
  item: AppNotification;
  onPress: (item: AppNotification) => void;
}

const NotificationRow = ({ item, onPress }: Props) => {
  const { isDark } = useAppTheme();

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={() => onPress(item)}>
      <Box
        backgroundColor="bg11"
        borderRadius={18}
        padding="m"
        flexDirection="row"
        alignItems="flex-start"
        mb="s"
        style={
          !isDark
            ? {
                borderWidth: 1,
                borderColor: '#F5F5F5',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.04,
                shadowRadius: 4,
                elevation: 2,
              }
            : {}
        }
      >
        <Box
          width={8}
          height={8}
          borderRadius={4}
          mt="xs"
          mr="s"
          backgroundColor={item.read ? 'transparent' : 'primary700'}
        />
        <Box flex={1}>
          <Text variant="h10" color="textPrimary" fontWeight={item.read ? '500' : '700'}>
            {item.title}
          </Text>
          <Text variant="p8" color="textSecondary" mt="xs">
            {item.body}
          </Text>
        </Box>
        <Text variant="p8" color="textSecondary" ml="s">
          {formatRelativeTime(item.created_at)}
        </Text>
      </Box>
    </TouchableOpacity>
  );
};

export default NotificationRow;
