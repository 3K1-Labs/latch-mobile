import { Theme } from '@/src/theme/theme';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import {
  LayoutRectangle,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import Box from '../shared/Box';
import Text from '../shared/Text';

const ICONS = {
  search: require('@/src/assets/images/swap/search.svg'),
  filter: require('@/src/assets/images/history/filter.svg'),
};

// Keys stay as the filter values history.tsx matches on; labels follow the design.
const FILTERS: { key: string; label: string }[] = [
  { key: 'All', label: 'All' },
  { key: 'Pending', label: 'Pending' },
  { key: 'Sent', label: 'Send' },
  { key: 'Received', label: 'Receive' },
  { key: 'Swap', label: 'Swaps' },
];

const SLIDE = {
  duration: 320,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
};

const SearchHeader = ({
  search,
  setSearch,
  activeFilter,
  setActiveFilter,
  theme,
  pendingCount = 0,
}: {
  search: string;
  setSearch: (t: string) => void;
  activeFilter: string;
  setActiveFilter: (f: string) => void;
  theme: Theme;
  pendingCount?: number;
}) => {
  const { width: screenWidth } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const layouts = useRef<Record<string, LayoutRectangle>>({});
  const placed = useRef(false);
  const indicatorX = useSharedValue(0);
  const indicatorWidth = useSharedValue(0);

  // Slides the single highlight to the active pill. The first placement snaps
  // so the screen doesn't open with the highlight gliding in from the left.
  const moveTo = (key: string, animate: boolean) => {
    const layout = layouts.current[key];
    if (!layout) return;
    if (animate) {
      indicatorX.value = withTiming(layout.x, SLIDE);
      indicatorWidth.value = withTiming(layout.width, SLIDE);
    } else {
      indicatorX.value = layout.x;
      indicatorWidth.value = layout.width;
    }
    // Keep the active pill fully on screen (Swaps sits past the edge).
    scrollRef.current?.scrollTo({
      x: Math.max(0, layout.x + layout.width / 2 - screenWidth / 2),
      animated: animate,
    });
  };

  useEffect(() => {
    moveTo(activeFilter, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter]);

  const indicatorStyle = useAnimatedStyle(() => ({
    width: indicatorWidth.value,
    transform: [{ translateX: indicatorX.value }],
  }));

  return (
    <Box paddingHorizontal="l" style={styles.root}>
      <Box flexDirection="row" alignItems="center" gap="s">
        <Box
          flex={1}
          flexDirection="row"
          alignItems="center"
          backgroundColor="inputBox"
          borderRadius={40}
          style={styles.search}
        >
          <Image source={ICONS.search} contentFit="contain" style={styles.searchIcon} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search for transactions..."
            placeholderTextColor={theme.colors.textPlaceholder}
            autoCorrect={false}
            autoCapitalize="none"
            style={[styles.searchInput, { color: theme.colors.textPrimary }]}
          />
        </Box>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Filter"
          onPress={() => router.push('/filter-sheet')}
          activeOpacity={0.7}
        >
          <Box
            width={56}
            height={48}
            borderRadius={40}
            backgroundColor="inputBox"
            alignItems="center"
            justifyContent="center"
          >
            <Image source={ICONS.filter} contentFit="contain" style={styles.filterIcon} />
          </Box>
        </TouchableOpacity>
      </Box>

      <Box backgroundColor="inputBox" borderRadius={40} style={styles.pills}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillRow}
        >
          <Animated.View pointerEvents="none" style={[styles.indicator, indicatorStyle]} />
          {FILTERS.map(({ key, label }) => {
            const active = activeFilter === key;
            const showBadge = key === 'Pending' && pendingCount > 0;
            return (
              <TouchableOpacity
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                activeOpacity={0.7}
                onPress={() => setActiveFilter(key)}
                onLayout={(e) => {
                  layouts.current[key] = e.nativeEvent.layout;
                  // Snap only the first placement. Later layout changes come
                  // from the active label's bolder font resizing the pill
                  // mid-slide; snapping then would cut the slide short.
                  if (key === activeFilter) {
                    moveTo(key, placed.current);
                    placed.current = true;
                  }
                }}
                style={styles.pill}
              >
                <Text
                  fontSize={14}
                  lineHeight={16}
                  letterSpacing={active ? 0 : 0.14}
                  fontFamily={active ? 'SFproMedium' : 'SFproRegular'}
                  style={{ color: active ? '#000000' : theme.colors.textMuted }}
                >
                  {label}
                </Text>
                {showBadge && (
                  <Box
                    borderRadius={9}
                    minWidth={18}
                    height={18}
                    alignItems="center"
                    justifyContent="center"
                    style={[styles.badge, { backgroundColor: active ? '#000000' : '#FFC508' }]}
                  >
                    <Text
                      fontSize={11}
                      lineHeight={14}
                      fontFamily="SFproSemibold"
                      style={{ color: active ? '#FFC508' : '#000000' }}
                    >
                      {pendingCount}
                    </Text>
                  </Box>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Box>
    </Box>
  );
};

const styles = StyleSheet.create({
  root: {
    marginTop: 20,
    gap: 12,
  },
  search: {
    height: 48,
    paddingHorizontal: 21,
    gap: 10,
  },
  searchIcon: {
    width: 13,
    height: 15,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    padding: 0,
    fontSize: 14,
    lineHeight: 18,
    fontFamily: 'SFproRegular',
  },
  filterIcon: {
    width: 24,
    height: 24,
  },
  pills: {
    height: 48,
    overflow: 'hidden',
  },
  pillRow: {
    padding: 4,
    gap: 4,
  },
  pill: {
    height: 40,
    minWidth: 68,
    paddingHorizontal: 16,
    borderRadius: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  indicator: {
    position: 'absolute',
    top: 4,
    left: 0,
    height: 40,
    borderRadius: 100,
    backgroundColor: '#FFC508',
  },
  badge: {
    paddingHorizontal: 5,
  },
});

export default SearchHeader;
