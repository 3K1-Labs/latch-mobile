import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import NetworkItem from '@/src/components/network/NetworkItem';
import BottomSheetHandle from '@/src/components/shared/BottomSheetHandle';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { SHEET_HEIGHT } from '@/src/constants/constants';
import { FIAT_CURRENCIES, type FiatCurrencyCode } from '@/src/constants/currencies';
import { useFxRates } from '@/src/hooks/use-fx-rates';
import { useDisplayCurrencyStore } from '@/src/store/display-currency';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Props {
  visible: boolean;
  onClose: () => void;
}

const CurrencySheet = ({ visible, onClose }: Props) => {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const { isDark } = useAppTheme();
  const selected = useDisplayCurrencyStore((s) => s.currency);
  const setCurrency = useDisplayCurrencyStore((s) => s.setCurrency);
  const { data: rates } = useFxRates();
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 90,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY]);

  const handleClose = () => {
    Animated.timing(translateY, {
      toValue: SCREEN_HEIGHT,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  const handleSelect = (code: FiatCurrencyCode) => {
    if (code === selected) return;
    setCurrency(code);
    handleClose();
  };

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={handleClose}>
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: isDark ? theme.colors.cardbg : theme.colors.mainBackground,
            paddingBottom: Math.max(insets.bottom, 16),
            transform: [{ translateY }],
            height: SHEET_HEIGHT,
          },
        ]}
      >
        <BottomSheetHandle />

        <Box
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          paddingHorizontal="m"
          py="m"
          mb="m"
        >
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={20} color={theme.colors.textPrimary} />
          </TouchableOpacity>

          <Text variant="h10" color="textPrimary" fontWeight="700">
            Currency
          </Text>

          <Box width={40} />
        </Box>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 }}>
          <Text variant="p8" color="textSecondary" mb="m">
            This is a device setting. Token amounts stay the same; only fiat
            labels convert from USD. If a rate is missing, figures fall back to
            USD and say so.
          </Text>
          {FIAT_CURRENCIES.map((currency) => {
            const rateMissing =
              currency.code !== 'USD' && !(rates && Number(rates[currency.code]) > 0);
            return (
              <TouchableOpacity
                key={currency.code}
                activeOpacity={0.7}
                onPress={() => handleSelect(currency.code)}
              >
                <NetworkItem
                  name={`${currency.name} (${currency.code})`}
                  description={
                    rateMissing
                      ? 'Rate unavailable — will show USD'
                      : `${currency.symbol} display`
                  }
                  isSelected={selected === currency.code}
                />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    width: '100%',
    position: 'absolute',
    bottom: 0,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 20,
  },
});

export default CurrencySheet;
