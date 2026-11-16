import { Theme } from '@/src/theme/theme';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, TextInput, TouchableOpacity } from 'react-native';

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
}) => (
  <Box paddingHorizontal="l" style={styles.root}>
    <Box flexDirection="row" alignItems="center" gap="s">
      <Box
        flex={1}
        flexDirection="row"
        alignItems="center"
        borderColor="inputOutline"
        borderWidth={1}
        borderRadius={40}
        style={styles.search}
      >
        <Image source={ICONS.search} contentFit="contain" style={styles.searchIcon} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search for transactions..."
          placeholderTextColor={theme.colors.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          style={styles.searchInput}
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
          borderWidth={1}
          borderColor="inputOutline"
          alignItems="center"
          justifyContent="center"
        >
          <Image source={ICONS.filter} contentFit="contain" style={styles.filterIcon} />
        </Box>
      </TouchableOpacity>
    </Box>

    <Box backgroundColor="inputBox" borderRadius={40} style={styles.pills}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRow}
      >
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
              style={[styles.pill, active && styles.pillActive]}
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

const styles = StyleSheet.create({
  root: {
    marginTop: 20,
    gap: 12,
  },
  search: {
    height: 48,
    paddingHorizontal: 19,
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
    color: '#FFFFFF',
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
  pillActive: {
    backgroundColor: '#FFC508',
  },
  badge: {
    paddingHorizontal: 5,
  },
});

export default SearchHeader;
