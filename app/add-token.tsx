import AddCustomTokenSheet from '@/src/components/add-token/AddCustomTokenSheet';
import TrackedTokenRow from '@/src/components/add-token/TrackedTokenRow';
import WellKnownTokenRow from '@/src/components/add-token/WellKnownTokenRow';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { getWellKnownTokens } from '@/src/constants/known-tokens';
import { useTrackedTokens } from '@/src/hooks/use-tracked-tokens';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AddToken() {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { tokens, addToken, removeToken, isTracked, loaded } = useTrackedTokens();
  const [sheetVisible, setSheetVisible] = useState(false);

  return (
    <Box flex={1} backgroundColor="mainBackground" style={{ paddingTop: insets.top }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Header */}
      <Box
        height={56}
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        paddingHorizontal="m"
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text variant="h10" color="textPrimary" fontFamily="SFproSemibold">
          Manage Tokens
        </Text>
        <TouchableOpacity
          onPress={() => setSheetVisible(true)}
          style={styles.addButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Box
            width={32}
            height={32}
            borderRadius={16}
            backgroundColor="primary700"
            justifyContent="center"
            alignItems="center"
          >
            <Ionicons name="add" size={20} color="#000" />
          </Box>
        </TouchableOpacity>
      </Box>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32 }}
      >
        {/* Your tracked tokens */}
        {tokens.length > 0 && (
          <>
            <Text variant="p7" color="textSecondary" fontWeight="600" mb="m" mt="s">
              YOUR TOKENS
            </Text>
            {tokens.map((token) => {
              const key = token.sacContractId ?? `${token.code}:${token.issuer}`;
              return (
                <TrackedTokenRow
                  key={key}
                  token={token}
                  isDark={isDark}
                  onRemove={() => removeToken(token)}
                />
              );
            })}
          </>
        )}

        {/* Popular tokens */}
        <Text variant="p7" color="textSecondary" fontWeight="600" mb="m" mt="m">
          POPULAR TOKENS
        </Text>

        {!loaded ? (
          <Box alignItems="center" py="l">
            <ActivityIndicator size="small" color={theme.colors.primary700} />
          </Box>
        ) : (
          getWellKnownTokens().map((token) => {
            const key = token.sacContractId ?? `${token.code}:${token.issuer}`;
            return (
              <WellKnownTokenRow
                key={key}
                token={token}
                tracked={isTracked(token)}
                onAdd={() => addToken(token)}
                onRemove={() => removeToken(token)}
                isDark={isDark}
                theme={theme}
              />
            );
          })
        )}
      </ScrollView>

      <AddCustomTokenSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        onAdd={addToken}
      />
    </Box>
  );
}

const styles = StyleSheet.create({
  backButton: {
    position: 'absolute',
    left: 16,
  },
  addButton: {
    position: 'absolute',
    right: 16,
  },
});
