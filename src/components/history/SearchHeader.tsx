import { Theme } from '@/src/theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, TouchableOpacity } from 'react-native';

import Box from '../shared/Box';
import Input from '../shared/Input';
import Text from '../shared/Text';

const FILTERS = ['All', 'Pending', 'Sent', 'Received', 'Swap'];

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
  <Box paddingHorizontal="m" mt="s">
    <Box flexDirection="row" alignItems="center" mb="m">
      <Box flex={1}>
        <Input
          placeholder="Search for transactions ..."
          value={search}
          onChangeText={setSearch}
          rightElement={
            <Ionicons name="search-outline" size={20} color={theme.colors.textSecondary} />
          }
        />
      </Box>
      <TouchableOpacity
        style={styles.filterButton}
        onPress={() => router.push('/filter-sheet')}
        activeOpacity={0.7}
      >
        <Ionicons name="filter-outline" size={20} color={theme.colors.textSecondary} />
      </TouchableOpacity>
    </Box>

    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filterContainer}
    >
      {FILTERS.map((filter) => {
        const isPending = filter === 'Pending';
        const showBadge = isPending && pendingCount > 0;
        return (
          <TouchableOpacity
            key={filter}
            onPress={() => setActiveFilter(filter)}
            style={[
              styles.filterChip,
              activeFilter === filter && {
                borderColor: theme.colors.primary700,
                backgroundColor: 'transparent',
              },
            ]}
          >
            <Box flexDirection="row" alignItems="center">
              <Text
                variant="p8"
                color={activeFilter === filter ? 'primary700' : 'textSecondary'}
              >
                {filter}
              </Text>
              {showBadge && (
                <Box
                  ml="xs"
                  backgroundColor="primary700"
                  borderRadius={8}
                  paddingHorizontal="xs"
                  minWidth={18}
                  alignItems="center"
                >
                  <Text variant="p8" color="black" style={{ fontWeight: '700' }}>
                    {pendingCount}
                  </Text>
                </Box>
              )}
            </Box>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  </Box>
);

const styles = StyleSheet.create({
  filterButton: {
    width: 48,
    height: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  filterContainer: {
    paddingVertical: 8,
    paddingRight: 16,
  },
  filterChip: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginRight: 8,
  },
});

export default SearchHeader;
