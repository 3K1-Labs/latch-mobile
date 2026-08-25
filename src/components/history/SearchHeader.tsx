import { Theme } from '@/src/theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, TouchableOpacity } from 'react-native';

import Box from '../shared/Box';
import Input from '../shared/Input';
import Text from '../shared/Text';

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
  const { t } = useTranslation();
  
  const FILTERS = [
    { key: 'All', label: t('history.filters.all') },
    { key: 'Pending', label: t('history.filters.pending') },
    { key: 'Sent', label: t('history.filters.sent') },
    { key: 'Received', label: t('history.filters.received') },
    { key: 'Swap', label: t('history.filters.swap') },
  ];

  return (
    <Box paddingHorizontal="m" mt="s">
      <Box flexDirection="row" alignItems="center" mb="m">
        <Box flex={1}>
          <Input
            placeholder={t('history.searchPlaceholder')}
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
          const isPending = filter.key === 'Pending';
          const showBadge = isPending && pendingCount > 0;
          return (
            <TouchableOpacity
              key={filter.key}
              onPress={() => setActiveFilter(filter.key)}
              style={[
                styles.filterChip,
                activeFilter === filter.key && {
                  borderColor: theme.colors.primary700,
                  backgroundColor: 'transparent',
                },
              ]}
            >
              <Box flexDirection="row" alignItems="center">
                <Text
                  variant="p8"
                  color={activeFilter === filter.key ? 'primary700' : 'textSecondary'}
                >
                  {filter.label}
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
};

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
