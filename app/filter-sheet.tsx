import Box from '@/src/components/shared/Box';
import DatePickerField from '@/src/components/shared/DatePickerField';
import FilterChip from '@/src/components/shared/FilterChip';
import Text from '@/src/components/shared/Text';
import UtilityHeader from '@/src/components/shared/UtilityHeader';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { endOfWeek, startOfMonth, startOfWeek, startOfYear, subDays, subWeeks } from 'date-fns';

import { useHistoryFilterStore } from '@/src/store/history-filter';

const PERIODS = ['Last 30 Days', 'Custom Period', 'Current Week', 'Last Week', 'Monthly', 'Yearly'];
const DEFAULT_PERIOD = 'Last 30 Days';

const FilterSheet = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const applied = useHistoryFilterStore((s) => s.range);
  const setRange = useHistoryFilterStore((s) => s.setRange);
  const clearRange = useHistoryFilterStore((s) => s.clear);
  const [selectedPeriod, setSelectedPeriod] = useState(applied?.period ?? DEFAULT_PERIOD);
  const [startDate, setStartDate] = useState(() => applied?.start ?? subDays(new Date(), 30));
  const [endDate, setEndDate] = useState(() => applied?.end ?? new Date());

  const handlePeriodSelect = (period: string) => {
    setSelectedPeriod(period);
    const now = new Date();

    switch (period) {
      case 'Last 30 Days':
        setStartDate(subDays(now, 30));
        setEndDate(now);
        break;
      case 'Current Week':
        setStartDate(startOfWeek(now));
        setEndDate(now);
        break;
      case 'Last Week':
        const lastWeek = subWeeks(now, 1);
        setStartDate(startOfWeek(lastWeek));
        setEndDate(endOfWeek(lastWeek));
        break;
      case 'Monthly':
        setStartDate(startOfMonth(now));
        setEndDate(now);
        break;
      case 'Yearly':
        setStartDate(startOfYear(now));
        setEndDate(now);
        break;
      default:
        // Keep current dates for "Custom Period"
        break;
    }
  };

  const handleClearAll = () => {
    clearRange();
    router.back();
  };

  const handleApply = () => {
    // Picked in either order, the range still reads earliest to latest.
    const [start, end] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
    setRange({ period: selectedPeriod, start, end });
    router.back();
  };

  return (
    <Box
      flex={1}
      backgroundColor="sheetBg"
      style={{ borderTopLeftRadius: 32, borderTopRightRadius: 32, overflow: 'hidden' }}
    >
      <UtilityHeader title="" onBack={() => router.back()} showHandle={true} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
      >
        <Text variant="p7" color="gray600" mb="m">
          Period
        </Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 32 }}>
          {PERIODS.map((period) => (
            <FilterChip
              key={period}
              label={period}
              selected={selectedPeriod === period}
              onPress={() => handlePeriodSelect(period)}
            />
          ))}
        </ScrollView>

        <DatePickerField label="Start Date" date={startDate} onChange={setStartDate} />

        <DatePickerField label="End Date" date={endDate} onChange={setEndDate} />
      </ScrollView>

      {/* Bottom Buttons */}
      <Box
        position="absolute"
        bottom={0}
        left={0}
        right={0}
        flexDirection="row"
        gap="m"
        padding="m"
        // backgroundColor="cardBackground"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.7} onPress={handleClearAll}>
          <Box
            height={48}
            backgroundColor="inputOutline"
            borderRadius={32}
            justifyContent="center"
            alignItems="center"
          >
            <Text variant="h10" color="textPrimary" fontWeight="700">
              Clear All
            </Text>
          </Box>
        </TouchableOpacity>

        <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.7} onPress={handleApply}>
          <Box
            height={48}
            backgroundColor="primary"
            borderRadius={32}
            justifyContent="center"
            alignItems="center"
          >
            <Text variant="h10" color="black" fontWeight="700">
              Apply
            </Text>
          </Box>
        </TouchableOpacity>
      </Box>
    </Box>
  );
};

export default FilterSheet;
