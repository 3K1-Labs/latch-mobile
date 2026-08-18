import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import type { SwapProviderMeta } from '@/src/services/swap/types';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { Image } from 'expo-image';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface RowProps {
  provider: SwapProviderMeta;
  selected: boolean;
  recommended: boolean;
  onPress: () => void;
}

function RouteRow({ provider, selected, recommended, onPress }: RowProps) {
  const theme = useTheme<Theme>();

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
      <Box
        flexDirection="row"
        alignItems="center"
        backgroundColor="bg11"
        borderRadius={16}
        padding="m"
        mb="s"
        height={72}
        borderWidth={1}
        borderColor={selected ? 'primary' : 'bg11'}
      >
        <Box
          width={40}
          height={40}
          borderRadius={12}
          backgroundColor="black"
          justifyContent="center"
          alignItems="center"
          mr="m"
          overflow="hidden"
        >
          <Image source={provider.icon} style={{ width: 40, height: 40 }} />
        </Box>
        <Box flex={1} flexDirection="row" alignItems="center">
          <Text variant="h10" color="textPrimary" fontWeight="700" style={{ marginRight: 8 }}>
            {provider.name}
          </Text>
          {recommended && (
            <Box
              paddingHorizontal="s"
              paddingVertical="xs"
              borderRadius={4}
              style={{ backgroundColor: '#211B0C' }}
            >
              <Text variant="p8" color="primary" style={{ fontSize: 10 }}>
                Recommend
              </Text>
            </Box>
          )}
        </Box>
        {selected && (
          <Ionicons name="checkmark-circle" size={22} color={theme.colors.primary} />
        )}
      </Box>
    </TouchableOpacity>
  );
}

interface Props {
  visible: boolean;
  providers: SwapProviderMeta[];
  selectedId: string;
  onClose: () => void;
  onSelect: (providerId: string) => void;
}

const SwapRoutePickerSheet = ({ visible, providers, selectedId, onClose, onSelect }: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(600)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
    } else {
      Animated.timing(translateY, {
        toValue: 600,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: isDark ? theme.colors.gray900 : theme.colors.white,
              paddingBottom: insets.bottom + 16,
              transform: [{ translateY }],
            },
          ]}
        >
          <Box alignItems="center" pt="m" pb="s">
            <Box width={36} height={4} borderRadius={2} backgroundColor="gray800" />
          </Box>

          <Box
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            paddingHorizontal="m"
            mb="m"
          >
            <Text variant="h10" color="textPrimary" fontWeight="700">
              Select route
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </Box>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.list}
            style={styles.scroll}
          >
            {providers.map((p, i) => (
              <RouteRow
                key={p.id}
                provider={p}
                selected={p.id === selectedId}
                recommended={i === 0}
                onPress={() => onSelect(p.id)}
              />
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
  },
  scroll: {
    flexGrow: 0,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
});

export default SwapRoutePickerSheet;
