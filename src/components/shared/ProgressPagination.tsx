import { useTheme } from '@shopify/restyle';
import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Theme } from '../../theme/theme';
import Box from './Box';

type ColorName = keyof Theme['colors'];

interface Props {
  total: number;
  activeIndex: number;
  dotSize?: number;
  activeWidth?: number;
  dotMargin?: number;
  activeColor?: ColorName;
  inactiveColor?: ColorName;
}

const DOT_SIZE = 10;
const ACTIVE_WIDTH = 26;
const SPACING = 8;

const ProgressPagination: React.FC<Props> = ({
  total,
  activeIndex,
  dotSize = DOT_SIZE,
  activeWidth = ACTIVE_WIDTH,
  dotMargin = SPACING / 3,
  activeColor = 'primary',
  inactiveColor = 'bg800',
}) => {
  const theme = useTheme<Theme>();

  return (
    <Box flexDirection="row" alignItems="center">
      {Array.from({ length: total }).map((_, index) => (
        <PaginationDot
          key={index}
          isActive={index === activeIndex}
          dotSize={dotSize}
          activeWidth={activeWidth}
          dotMargin={dotMargin}
          activeColor={theme.colors[activeColor]}
          inactiveColor={theme.colors[inactiveColor]}
        />
      ))}
    </Box>
  );
};

interface DotProps {
  isActive: boolean;
  dotSize: number;
  activeWidth: number;
  dotMargin: number;
  activeColor: string;
  inactiveColor: string;
}

const PaginationDot: React.FC<DotProps> = ({
  isActive,
  dotSize,
  activeWidth,
  dotMargin,
  activeColor,
  inactiveColor,
}) => {
  const width = useSharedValue(isActive ? activeWidth : dotSize);

  useEffect(() => {
    width.value = withSpring(isActive ? activeWidth : dotSize, {
      damping: 20,
      stiffness: 200,
    });
  }, [isActive, activeWidth, dotSize, width]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      width: width.value,
      backgroundColor: isActive ? activeColor : inactiveColor,
    };
  });

  return (
    <Animated.View
      style={[
        styles.dot,
        animatedStyle,
        {
          height: dotSize,
          borderRadius: dotSize / 2,
          marginHorizontal: dotMargin,
        },
      ]}
    />
  );
};

const styles = StyleSheet.create({
  dot: {
    // Basic styles handled in animated style or inline
  },
});

export default ProgressPagination;
