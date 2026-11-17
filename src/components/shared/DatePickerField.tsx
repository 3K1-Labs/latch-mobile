import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useTheme } from '@shopify/restyle';
import { format } from 'date-fns';
import React, { useState } from 'react';
import { Platform, TouchableOpacity } from 'react-native';

interface DatePickerFieldProps {
  label: string;
  date: Date;
  onChange: (date: Date) => void;
}

const DatePickerField = ({ label, date, onChange }: DatePickerFieldProps) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();

  const [show, setShow] = useState(false);

  const handleDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      // Android shows a native dialog with OK/Cancel — close on either action.
      setShow(false);
      if (event.type === 'set' && selectedDate) {
        onChange(selectedDate);
      }
    } else {
      // iOS spinner fires 'set' on every column spin (day, month, year).
      // Don't auto-close — let the user finish and tap "Done".
      if (event.type === 'dismissed') {
        setShow(false);
      } else if (selectedDate) {
        onChange(selectedDate);
      }
    }
  };

  return (
    <Box mb="l">
      <Text variant="h10" color="textPrimary" fontWeight="700" mb="s">
        {label}
      </Text>

      <TouchableOpacity activeOpacity={0.7} onPress={() => setShow((v) => !v)}>
        <Box
          flexDirection="row"
          justifyContent="space-between"
          alignItems="center"
          paddingHorizontal="m"
          height={64}
          borderRadius={24}
          borderWidth={1}
          borderColor={show ? 'primary700' : isDark ? 'gray800' : 'gray400'}
          backgroundColor="chipBg"
        >
          <Text variant="p6" color="textPrimary">
            {format(date, 'd MMMM yyyy')}
          </Text>
          <Ionicons
            name={show ? 'chevron-up' : 'calendar-outline'}
            size={24}
            color={show ? theme.colors.primary700 : theme.colors.gray600}
          />
        </Box>
      </TouchableOpacity>

      {show && (
        <Box
          mt="s"
          borderRadius={20}
          borderWidth={1}
          borderColor={isDark ? 'gray800' : 'gray400'}
          backgroundColor="chipBg"
          overflow="hidden"
        >
          <DateTimePicker
            value={date}
            mode="date"
            display={Platform.OS === 'android' ? 'default' : 'spinner'}
            onChange={handleDateChange}
            maximumDate={new Date()}
            textColor={theme.colors.textPrimary}
            themeVariant={isDark ? 'dark' : 'light'}
            style={{ width: '100%' }}
          />

          {Platform.OS === 'ios' && (
            <Box flexDirection="row" justifyContent="flex-end" px="m" pb="m" pt="xs">
              <TouchableOpacity activeOpacity={0.7} onPress={() => setShow(false)}>
                <Box
                  px="l"
                  py="s"
                  backgroundColor="primary700"
                  borderRadius={20}
                  justifyContent="center"
                  alignItems="center"
                >
                  <Text variant="p7" color="black" fontWeight="700">
                    Done
                  </Text>
                </Box>
              </TouchableOpacity>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default DatePickerField;
