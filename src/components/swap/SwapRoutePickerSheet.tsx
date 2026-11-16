import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import type { SwapProviderMeta } from '@/src/services/swap/types';
import { Theme } from '@/src/theme/theme';
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

const CLOSE = require('@/src/assets/images/swap/close.svg');

interface RowProps {
  provider: SwapProviderMeta;
  selected: boolean;
  recommended: boolean;
  onPress: () => void;
}

function RouteRow({ provider, selected, recommended, onPress }: RowProps) {
  return (
    <TouchableOpacity
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      activeOpacity={0.7}
      onPress={onPress}
    >
      <Box
        flexDirection="row"
        alignItems="center"
        backgroundColor="inputBox"
        borderColor="inputOutline"
        borderWidth={1}
        borderRadius={16}
        style={styles.row}
      >
        <Image source={provider.icon} style={styles.logo} />
        <Text flex={1} fontSize={16} lineHeight={24} letterSpacing={0.32} color="textPrimary">
          {provider.name}
        </Text>
        {recommended && (
          <Text fontSize={12} lineHeight={24} letterSpacing={0.24} color="textMuted">
            Recommended
          </Text>
        )}
        <Box
          width={18}
          height={18}
          borderRadius={9}
          borderWidth={1.5}
          borderColor={selected ? 'accentGreen' : 'textMuted'}
          alignItems="center"
          justifyContent="center"
        >
          {selected && <Box width={10} height={10} borderRadius={5} backgroundColor="accentGreen" />}
        </Box>
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
              backgroundColor: theme.colors.surfaceBase,
              paddingBottom: insets.bottom + 16,
              transform: [{ translateY }],
            },
          ]}
        >
          <Box alignItems="center" style={styles.grabberWrap}>
            <Box width={126} height={8} borderRadius={69} backgroundColor="inputOutline" />
          </Box>

          <Box flexDirection="row" alignItems="center" justifyContent="center" style={styles.header}>
            <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
              Change Provider
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              hitSlop={8}
              style={styles.close}
            >
              <Image source={CLOSE} contentFit="contain" style={styles.closeIcon} />
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
    backgroundColor: 'rgba(18,18,18,0.9)',
  },
  sheet: {
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    maxHeight: '80%',
  },
  grabberWrap: {
    paddingTop: 10,
  },
  header: {
    marginTop: 20,
    marginBottom: 32,
    paddingHorizontal: 24,
    height: 40,
  },
  close: {
    position: 'absolute',
    right: 24,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    width: 20,
    height: 20,
  },
  scroll: {
    flexGrow: 0,
  },
  list: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    gap: 10,
  },
  row: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 14,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
});

export default SwapRoutePickerSheet;
