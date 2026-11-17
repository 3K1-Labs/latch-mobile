import { useTheme } from '@shopify/restyle';
import { Image } from 'expo-image';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import SheetHeader from '@/src/components/profile/SheetHeader';
import BottomSheet from '@/src/components/shared/BottomSheet';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import {
  type NotificationCategory,
  useNotificationPrefsStore,
} from '@/src/store/notification-prefs';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

const ICONS = {
  receipt: require('@/src/assets/images/settings/notif-receipt.svg'),
  receiptLight: require('@/src/assets/images/settings/notif-receipt-light.svg'),
  security: require('@/src/assets/images/settings/notif-security.svg'),
  alert: require('@/src/assets/images/settings/notif-alert.svg'),
};

const OPTIONS: { category: NotificationCategory; title: string; description: string }[] = [
  {
    category: 'transactions',
    title: 'Transaction Notifications',
    description: 'Get notified about incoming and outgoing transactions',
  },
  {
    category: 'security',
    title: 'Security Alerts',
    description: 'Important security updates and warnings',
  },
  {
    category: 'appUpdates',
    title: 'App Updates',
    description: 'New features and improvements to Latch',
  },
];

const TRACK_W = 36;
const KNOB = 16;
const INSET = 2;
const TRAVEL = TRACK_W - KNOB - INSET * 2;

const PrefSwitch = ({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) => {
  const theme = useTheme<Theme>();
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
  }, [progress, value]);

  const offColor = theme.colors.switchOff;
  const onColor = theme.colors.accentGreen;
  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [offColor, onColor]),
  }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * TRAVEL }],
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      hitSlop={12}
      onPress={() => onChange(!value)}
      style={styles.switchSlot}
    >
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.knob, knobStyle]} />
      </Animated.View>
    </Pressable>
  );
};

interface Props {
  visible: boolean;
  onClose: () => void;
}

const NotificationsSheet = ({ visible, onClose }: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const prefs = useNotificationPrefsStore((s) => s.prefs);
  const setPref = useNotificationPrefsStore((s) => s.setPref);
  const rehydrate = useNotificationPrefsStore((s) => s.rehydrate);

  useEffect(() => {
    if (visible) rehydrate();
  }, [visible, rehydrate]);

  const iconFor = (category: NotificationCategory) => {
    if (category === 'transactions') {
      // Two-tone glyph: a tint would erase the $ cut-out, so light mode has its own file.
      return <Image source={isDark ? ICONS.receipt : ICONS.receiptLight} contentFit="contain" style={styles.glyph} />;
    }
    return (
      <Image
        source={category === 'security' ? ICONS.security : ICONS.alert}
        contentFit="contain"
        tintColor={theme.colors.tileGlyph}
        style={styles.glyph}
      />
    );
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['92%']}
      scrollable
      backgroundStyle={{ backgroundColor: theme.colors.surfaceBase }}
      header={<SheetHeader title="Notifications" onBack={onClose} />}
      contentContainerStyle={styles.content}
    >
      {OPTIONS.map((option) => (
        <Box key={option.category} flexDirection="row" alignItems="flex-start" gap="sm">
          <Box backgroundColor="inputOutline" justifyContent="center" alignItems="center" style={styles.tile}>
            {iconFor(option.category)}
          </Box>
          <Box flex={1} gap="xs">
            <Text fontSize={16} lineHeight={24} fontFamily="SFproMedium" color="textPrimary">
              {option.title}
            </Text>
            <Text fontSize={14} lineHeight={19} color="textSubheading">
              {option.description}
            </Text>
          </Box>
          <PrefSwitch
            label={option.title}
            value={prefs[option.category]}
            onChange={(next) => setPref(option.category, next)}
          />
        </Box>
      ))}
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 24,
  },
  tile: {
    width: 49,
    height: 48,
    borderRadius: 12,
  },
  glyph: {
    width: 24,
    height: 24,
  },
  switchSlot: {
    paddingTop: 4,
    marginLeft: 23,
  },
  track: {
    width: TRACK_W,
    height: 20,
    borderRadius: 10,
    padding: INSET,
  },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: '#FFFFFF',
    shadowColor: '#272727',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
});

export default NotificationsSheet;
