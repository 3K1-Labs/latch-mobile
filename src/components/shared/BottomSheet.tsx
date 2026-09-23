import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps, BottomSheetModalProps, BottomSheetScrollView as BottomSheetScrollViewType } from '@gorhom/bottom-sheet';
import { useTheme } from '@shopify/restyle';
import React, { useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Theme } from '@/src/theme/theme';

interface Props extends Omit<BottomSheetModalProps, 'onDismiss' | 'children' | 'ref'> {
  visible: boolean;
  onClose: () => void;
  /** Provide snap points (e.g. ['92%']) for a fixed-height sheet. Omit to use dynamic sizing. */
  snapPoints?: string[];
  /** Render content inside a ScrollView instead of a plain View. */
  scrollable?: boolean;
  /**
   * Rendered above the content, outside the scroll area, so it stays pinned
   * while the body scrolls. Sits below the drag handle.
   */
  header?: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Extra props forwarded to BottomSheetScrollView (only used when scrollable=true). */
  scrollViewProps?: Omit<React.ComponentProps<typeof BottomSheetScrollViewType>, 'children' | 'contentContainerStyle'>;
  children: React.ReactNode;
}

const BottomSheet = ({
  visible,
  onClose,
  snapPoints,
  scrollable = false,
  header,
  contentContainerStyle,
  scrollViewProps,
  children,
  ...rest
}: Props) => {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const ref = useRef<BottomSheetModal>(null);
  const hasPresented = useRef(false);

  useEffect(() => {
    if (visible) {
      hasPresented.current = true;
      ref.current?.present();
    } else if (hasPresented.current) {
      ref.current?.dismiss();
    }
  }, [visible]);

  const handleDismiss = useCallback(() => {
    hasPresented.current = false;
    onClose();
  }, [onClose]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.7}
        pressBehavior="close"
      />
    ),
    [],
  );

  // With explicit snap points, keep dynamic sizing off — otherwise gorhom adds a
  // content-height snap point, which measures wrong when a fixed `header` sits
  // as a sibling above the scroll/content view.
  const modalProps: Partial<BottomSheetModalProps> = snapPoints
    ? { snapPoints, enableDynamicSizing: false }
    : { enableDynamicSizing: true };

  const defaultContentStyle: StyleProp<ViewStyle> = {
    paddingBottom: Math.max(insets.bottom + 16, 32),
  };

  return (
    <BottomSheetModal
      ref={ref}
      {...modalProps}
      onDismiss={handleDismiss}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: theme.colors.bg11 }}
      handleIndicatorStyle={{ backgroundColor: theme.colors.gray800, width: 36, height: 4 }}
      {...rest}
    >
      {header}
      {scrollable ? (
        <BottomSheetScrollView
          showsVerticalScrollIndicator={false}
          bounces={false}
          // A pinned header is a sibling above this view, so it must flex to fill
          // the rest of the sheet rather than grow to its content height.
          style={header ? { flex: 1 } : undefined}
          {...scrollViewProps}
          contentContainerStyle={contentContainerStyle ?? defaultContentStyle}
        >
          {children}
        </BottomSheetScrollView>
      ) : snapPoints ? (
        // Fixed-height sheet: gorhom gives the content wrapper a definite height,
        // so a plain flex View fills it. BottomSheetView can't be used here — it
        // renders `position: absolute` and sizes to its content, which ignores
        // `flex: 1` and overlaps the pinned header.
        <View style={[{ flex: 1, paddingBottom: Math.max(insets.bottom, 16) }, contentContainerStyle]}>
          {children}
        </View>
      ) : (
        // Dynamic-sizing sheet: BottomSheetView measures its content so the sheet
        // grows to fit.
        <BottomSheetView style={contentContainerStyle ?? defaultContentStyle}>
          {children}
        </BottomSheetView>
      )}
    </BottomSheetModal>
  );
};

export default BottomSheet;
