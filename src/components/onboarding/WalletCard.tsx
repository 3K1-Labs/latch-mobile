import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { DEFAULT_CARD_COLOR, isLightColor, shadeColor } from '@/src/lib/wallet-customisation';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet } from 'react-native';

export const CARD_ASPECT_RATIO = 310 / 167;

const WalletCard = ({
  color,
  name,
  image,
  address,
  addressColor,
}: {
  color: string | null;
  name: string;
  image: string | null;
  address: string;
  addressColor: string;
}) => {
  // Bright cards (e.g. yellow) need dark text; the default white-on-colour washes out.
  const light = isLightColor(color ?? DEFAULT_CARD_COLOR);
  const chipText = light ? 'rgba(0,0,0,0.7)' : addressColor;
  return (
    <Box
      p="m"
      justifyContent="space-between"
      overflow="hidden"
      borderRadius={28}
      style={[styles.card, { backgroundColor: shadeColor(color ?? DEFAULT_CARD_COLOR, 0.08) }]}
    >
      <Image
        source={require('@/src/assets/images/onboarding/create-wallet/card-texture.png')}
        contentFit="cover"
        style={StyleSheet.absoluteFill}
      />
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box
          width={28}
          height={28}
          borderRadius={14}
          overflow="hidden"
          backgroundColor="textSubtle"
        >
          {image && <Image source={{ uri: image }} contentFit="cover" style={styles.fill} />}
        </Box>
        <Box
          flexDirection="row"
          alignItems="center"
          gap="xs"
          height={28}
          paddingHorizontal="sm"
          borderRadius={14}
          style={light ? styles.addressChipOnLight : styles.addressChip}
        >
          <Text
            fontSize={10}
            fontFamily="SFproMedium"
            letterSpacing={-0.35}
            style={{ color: chipText }}
          >
            {address}
          </Text>
          <Ionicons name="copy-outline" size={10} color={chipText} />
        </Box>
      </Box>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text
          variant="p8"
          letterSpacing={0}
          numberOfLines={1}
          style={[styles.name, light && styles.nameOnLight]}
        >
          {name}
        </Text>
        <Image
          source={require('@/src/assets/images/logoLoading.png')}
          contentFit="contain"
          style={styles.logo}
        />
      </Box>
    </Box>
  );
};

const styles = StyleSheet.create({
  card: {
    width: '100%',
    aspectRatio: CARD_ASPECT_RATIO,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  addressChip: {
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  addressChipOnLight: {
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  name: {
    flexShrink: 1,
    color: 'rgba(255,255,255,0.7)',
  },
  nameOnLight: {
    color: 'rgba(0,0,0,0.6)',
  },
  logo: {
    width: 20,
    height: 20,
  },
});

export default WalletCard;
