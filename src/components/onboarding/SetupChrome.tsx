import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { useTheme } from '@shopify/restyle';
import { Image } from 'expo-image';
import React, { useEffect } from 'react';
import { Pressable, StyleProp, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

// The bundled Semibold cut runs about 14% wider than Figma's SF Pro Display.
export const SEMIBOLD_TRACKING = -1.2;

export const RoundBackButton = ({
  onPress,
  disabled,
  style,
}: {
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Go back"
      activeOpacity={0.7}
      hitSlop={8}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.back,
        { backgroundColor: theme.colors.controlBg },
        // Figma's light control sits on a white 2pt ring.
        !isDark && styles.backLight,
        disabled && styles.backDisabled,
        style,
      ]}
    >
      <Image
        source={require('@/src/assets/images/onboarding/create-wallet/back-arrow.svg')}
        contentFit="fill"
        tintColor={theme.colors.iconPrimary}
        style={styles.backIcon}
      />
    </TouchableOpacity>
  );
};

export const SetupHeading = ({
  title,
  subtitle,
  align = 'center',
}: {
  title: string;
  subtitle: string;
  align?: 'center' | 'left';
}) => (
  <Box alignItems={align === 'center' ? 'center' : 'flex-start'} gap="xs">
    <Text
      variant="p4"
      fontFamily="SFproSemibold"
      letterSpacing={SEMIBOLD_TRACKING}
      textAlign={align}
      color="textPrimary"
    >
      {title}
    </Text>
    <Text
      variant="p6"
      lineHeight={24}
      letterSpacing={0}
      textAlign={align}
      color="textSubheading"
    >
      {subtitle}
    </Text>
  </Box>
);

type ButtonProps = React.ComponentProps<typeof Button>;

export const SetupButton = ({
  busy,
  disabled,
  ...rest
}: Omit<ButtonProps, 'variant' | 'bg' | 'labelColor' | 'labelStyle'> & { busy?: boolean }) => {
  const off = busy || disabled;
  return (
    <Button
      {...rest}
      variant={off ? 'disabled' : 'ghost'}
      bg={off ? 'btnDisabled' : 'buttonBg'}
      labelColor={off ? 'gray600' : 'buttonLabel'}
      labelStyle={styles.buttonLabel}
      disabled={off}
    />
  );
};

const RING_RADIUS = 10.5;
const RING_CENTER = 12;

const ringArc = (startDeg: number, endDeg: number) => {
  const point = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${RING_CENTER + RING_RADIUS * Math.cos(rad)} ${RING_CENTER + RING_RADIUS * Math.sin(rad)}`;
  };
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${point(startDeg)} A ${RING_RADIUS} ${RING_RADIUS} 0 ${largeArc} 1 ${point(endDeg)}`;
};

export const StepIndicator = ({ step, total = 4 }: { step: number; total?: number }) => (
  <Box flexDirection="row" alignItems="center" gap="s">
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path d={ringArc(33, 170)} stroke="#6F6F6F" strokeWidth={2.5} strokeLinecap="round" />
      <Path d={ringArc(178, 257)} stroke="#6F6F6F" strokeWidth={2.5} strokeLinecap="round" />
      <Path d={ringArc(-95, 25)} stroke="#FFC508" strokeWidth={2.5} strokeLinecap="round" />
    </Svg>
    <Text variant="p7" lineHeight={22} letterSpacing={0} color="textSubheading">
      Step {step} of {total}
    </Text>
  </Box>
);

export const SetupTitle = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <Box gap="s">
    <Text
      variant="p4"
      fontFamily="SFproSemibold"
      letterSpacing={SEMIBOLD_TRACKING}
      color="textPrimary"
    >
      {title}
    </Text>
    <Text variant="p6" lineHeight={24} letterSpacing={0} color="textSubheading">
      {children}
    </Text>
  </Box>
);

const SWITCH_TRAVEL = 16;

export const CompactSwitch = ({
  value,
  onValueChange,
  label,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  label: string;
}) => {
  const offset = useSharedValue(value ? SWITCH_TRAVEL : 0);

  useEffect(() => {
    offset.value = withTiming(value ? SWITCH_TRAVEL : 0, { duration: 150 });
  }, [offset, value]);

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      hitSlop={10}
      onPress={() => onValueChange(!value)}
    >
      <Box
        width={36}
        height={20}
        borderRadius={10}
        justifyContent="center"
        backgroundColor={value ? 'accentGreen' : 'inputOutline'}
      >
        <Animated.View style={[styles.switchThumb, thumbStyle]} />
      </Box>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#B1B1B1',
    shadowOffset: { width: -1, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  backLight: {
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  backDisabled: {
    opacity: 0.5,
  },
  backIcon: {
    width: 20,
    height: 20,
  },
  buttonLabel: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: 'SFproMedium',
    fontWeight: 'normal',
    letterSpacing: -0.35,
  },
  switchThumb: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginLeft: 2,
    backgroundColor: '#FFFFFF',
  },
});
