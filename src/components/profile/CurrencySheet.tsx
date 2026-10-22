import { useTheme } from '@shopify/restyle';
import React from 'react';
import { TouchableOpacity } from 'react-native';

import NetworkItem from '@/src/components/network/NetworkItem';
import SheetHeader from '@/src/components/profile/SheetHeader';
import BottomSheet from '@/src/components/shared/BottomSheet';
import Text from '@/src/components/shared/Text';
import { FIAT_CURRENCIES, type FiatCurrencyCode } from '@/src/constants/currencies';
import { useFxRates } from '@/src/hooks/use-fx-rates';
import { useDisplayCurrencyStore } from '@/src/store/display-currency';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const CurrencySheet = ({ visible, onClose }: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const selected = useDisplayCurrencyStore((s) => s.currency);
  const setCurrency = useDisplayCurrencyStore((s) => s.setCurrency);
  const { data: rates } = useFxRates();

  const handleSelect = (code: FiatCurrencyCode) => {
    if (code === selected) return;
    setCurrency(code);
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['92%']}
      scrollable
      backgroundStyle={{
        backgroundColor: isDark ? theme.colors.cardbg : theme.colors.mainBackground,
      }}
      header={<SheetHeader title="Currency" onBack={onClose} />}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 }}
    >
      <Text variant="p8" color="textSecondary" mb="m">
        This is a device setting. Token amounts stay the same; only fiat labels convert from USD. If a
        rate is missing, figures fall back to USD and say so.
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
                rateMissing ? 'Rate unavailable — will show USD' : `${currency.symbol} display`
              }
              isSelected={selected === currency.code}
            />
          </TouchableOpacity>
        );
      })}
    </BottomSheet>
  );
};

export default CurrencySheet;
