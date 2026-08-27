import Box from '@/src/components/shared/Box';
import Input from '@/src/components/shared/Input';
import Text from '@/src/components/shared/Text';
import { getWellKnownTokens } from '@/src/constants/known-tokens';
import { useTabBarScroll } from '@/src/context/tab-bar-scroll';
import { usePrices } from '@/src/hooks/use-prices';
import { useDisplayFiat } from '@/src/hooks/use-display-fiat';
import { useTokenIcon } from '@/src/hooks/use-token-list';
import { disconnectSession, getActiveSessions } from '@/src/lib/walletconnect';
import { useWalletConnectStore } from '@/src/store/walletconnect';
import { Theme } from '@/src/theme/theme';
import { UNPRICED_LABEL } from '@/src/utils/format-fiat';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useMemo, useState } from 'react';
import { Dimensions, FlatList, Linking, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const banners = [
  { id: 1, image: require('@/src/assets/banners/smart-accounts.png') },
  { id: 2, image: require('@/src/assets/banners/multisig.png') },
  { id: 3, image: require('@/src/assets/banners/swap.png') },
  { id: 4, image: require('@/src/assets/banners/session-keys.png') },
];

const RECOMMENDED_DAPPS = [
  {
    id: '1',
    name: 'StellarX',
    description: 'Decentralized exchange',
    url: 'https://stellarx.com',
    icon: require('@/src/assets/token/stellar.png'),
  },
  {
    id: '2',
    name: 'Soroswap',
    description: 'AMM & liquidity protocol',
    url: 'https://soroswap.finance',
    icon: require('@/src/assets/token/stellar.png'),
  },
  {
    id: '3',
    name: 'Stellar Expert',
    description: 'Block explorer',
    url: 'https://stellar.expert',
    icon: require('@/src/assets/token/stellar.png'),
  },
  {
    id: '4',
    name: 'Blend Capital',
    description: 'Lending & borrowing',
    url: 'https://mainnet.blend.capital',
    icon: require('@/src/assets/token/stellar.png'),
  },
];

// Tokens to feature in the trending section — XLM first, then well-known tokens.
const FEATURED_CODES = ['XLM', 'USDC', 'USDT', 'EURC'];

function formatChange(change: number): string {
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}

function formatPrice(
  price: string | undefined,
  formatUsdValue: (usd: number) => { text: string },
): string {
  const n = parseFloat(price ?? '');
  if (!isFinite(n)) return UNPRICED_LABEL;
  return formatUsdValue(n).text;
}

interface TokenRowProps {
  code: string;
  name: string;
  issuer?: string;
  /** Undefined when the token has no quote — the row shows UNPRICED_LABEL. */
  price?: string;
  change?: number;
  isDark: boolean;
}

function TokenRow({ code, name, issuer, price, change, isDark }: TokenRowProps) {
  const iconUrl = useTokenIcon(code, issuer);
  const isPositive = (change ?? 0) >= 0;
  const { formatUsdValue } = useDisplayFiat();

  return (
    <Box
      backgroundColor="bg900"
      borderRadius={18}
      padding="m"
      flexDirection="row"
      alignItems="center"
      mb="s"
    >
      <Box
        width={44}
        height={44}
        borderRadius={12}
        backgroundColor="bg800"
        justifyContent="center"
        alignItems="center"
        mr="m"
        overflow="hidden"
      >
        {iconUrl ? (
          <Image source={{ uri: iconUrl }} style={{ width: 28, height: 28 }} contentFit="contain" />
        ) : (
          <Image
            source={require('@/src/assets/token/stellar.png')}
            style={{ width: 24, height: 24 }}
          />
        )}
      </Box>
      <Box flex={1}>
        <Text variant="h10" color="textPrimary">
          {name}
        </Text>
        <Text variant="p8" color="textSecondary">
          {code}
        </Text>
      </Box>
      <Box alignItems="flex-end">
        <Text variant="h10" color="textPrimary">
          {formatPrice(price, formatUsdValue)}
        </Text>
        {change != null && (
          <Text variant="p8" color={isPositive ? 'success700' : 'inputError'}>
            {formatChange(change)}
          </Text>
        )}
      </Box>
    </Box>
  );
}

interface ConnectedAppRowProps {
  topic: string;
  name: string;
  url: string;
  icon?: string;
  onDisconnect: (topic: string) => void;
}

function ConnectedAppRow({ topic, name, url, icon, onDisconnect }: ConnectedAppRowProps) {
  return (
    <Box
      backgroundColor="bg900"
      borderRadius={18}
      padding="m"
      flexDirection="row"
      alignItems="center"
      mb="s"
    >
      <Box
        width={44}
        height={44}
        borderRadius={12}
        backgroundColor="bg800"
        justifyContent="center"
        alignItems="center"
        mr="m"
        overflow="hidden"
      >
        {icon ? (
          <Image source={{ uri: icon }} style={{ width: 28, height: 28 }} contentFit="contain" />
        ) : (
          <Text variant="h10" color="textSecondary">
            {name[0]?.toUpperCase() ?? '?'}
          </Text>
        )}
      </Box>
      <Box flex={1}>
        <Text variant="h10" color="textPrimary" numberOfLines={1}>
          {name}
        </Text>
        <Text variant="p8" color="textSecondary" numberOfLines={1}>
          {url}
        </Text>
      </Box>
      <TouchableOpacity onPress={() => onDisconnect(topic)}>
        <Text variant="p7" color="inputError" style={{ fontWeight: '600' }}>
          Disconnect
        </Text>
      </TouchableOpacity>
    </Box>
  );
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const Explore = () => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const tabBarScroll = useTabBarScroll();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [bannerIndex, setBannerIndex] = useState(0);

  const { data: prices } = usePrices();
  const { activeSessions, setActiveSessions } = useWalletConnectStore();

  useFocusEffect(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['prices'] });
      setActiveSessions(getActiveSessions());
    }, [queryClient, setActiveSessions]),
  );

  const connectedApps = useMemo(
    () =>
      Object.values(activeSessions).map((session) => ({
        topic: session.topic,
        name: session.peer.metadata.name,
        url: session.peer.metadata.url,
        icon: session.peer.metadata.icons?.[0],
      })),
    [activeSessions],
  );

  const handleDisconnect = useCallback(
    (topic: string) => {
      disconnectSession(topic)
        .catch(() => {
          // best-effort — refresh regardless so a stale session doesn't linger in the UI
        })
        .finally(() => setActiveSessions(getActiveSessions()));
    },
    [setActiveSessions],
  );

  const trendingTokens = useMemo(() => {
    const tokenMap = new Map(getWellKnownTokens().map((t) => [t.code.toUpperCase(), t]));
    return FEATURED_CODES.map((code) => {
      const config = tokenMap.get(code);
      const priceData = prices?.[code];
      return {
        code,
        name: config?.name ?? code,
        issuer: config?.issuer,
        price: priceData?.price,
        change: priceData?.change_24h,
      };
    });
  }, [prices]);

  const q = search.trim().toLowerCase();

  const filteredDapps = useMemo(
    () =>
      q
        ? RECOMMENDED_DAPPS.filter(
            (d) => d.name.toLowerCase().includes(q) || d.description.toLowerCase().includes(q),
          )
        : RECOMMENDED_DAPPS,
    [q],
  );

  const filteredTokens = useMemo(
    () =>
      q
        ? trendingTokens.filter(
            (t) => t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
          )
        : trendingTokens,
    [trendingTokens, q],
  );

  return (
    <Box flex={1} backgroundColor="mainBackground" style={{ paddingTop: insets.top }}>
<StatusBar style="light" />

      {/* Header */}
      <Box
        height={56}
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        paddingHorizontal="m"
      >
        <Text variant="h10" color="textPrimary" fontFamily="SFproSemibold">
          Explore
        </Text>
        <Box position="absolute" right={16}>
          <TouchableOpacity onPress={() => router.push('/qrcode-scan')}>
            <MaterialCommunityIcons
              name="qrcode-scan"
              size={22}
              color={isDark ? theme.colors.bgDark700 : theme.colors.bgDark100}
            />
          </TouchableOpacity>
        </Box>
      </Box>

      <ScrollView
        {...tabBarScroll}
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        bounces={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <Box paddingHorizontal="m" mt="s">
          {/* Search Bar */}
          <Box mb="l">
            <Input
              placeholder="Search assets or dApps"
              value={search}
              onChangeText={setSearch}
              rightElement={
                <Ionicons name="search-outline" size={20} color={theme.colors.textSecondary} />
              }
            />
          </Box>

          {/* Banner Carousel */}
          {!q && (
            // Full-bleed: pagingEnabled snaps by the list's own viewport width,
            // so the slides must be exactly that wide. Inside the parent's
            // paddingHorizontal="m" the viewport is SCREEN_WIDTH - 32 while each
            // slide is SCREEN_WIDTH, which drifts a further 32px every page.
            // Cancel the padding here and inset the card instead.
            <Box mb="xl" style={{ marginHorizontal: -theme.spacing.m }}>
              <FlatList
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                data={banners}
                // The page has settled here, so this is exact — onScroll without
                // scrollEventThrottle barely fires on iOS and desynced the dots.
                onMomentumScrollEnd={(e) => {
                  const x = e.nativeEvent.contentOffset.x;
                  setBannerIndex(Math.round(x / SCREEN_WIDTH));
                }}
                keyExtractor={(item) => item.id.toString()}
                renderItem={({ item }) => (
                  <Box width={SCREEN_WIDTH} alignItems="center" justifyContent="center">
                    <Box width={SCREEN_WIDTH - 32} height={101} overflow="hidden" borderRadius={12}>
                      <Image
                        source={item.image}
                        style={{ height: '100%', width: '100%' }}
                        contentFit="cover"
                      />
                    </Box>
                  </Box>
                )}
              />
              <Box flexDirection="row" justifyContent="center" mt="m" gap="xs">
                {banners.map((banner, i) => (
                  <Box
                    key={banner.id}
                    width={bannerIndex === i ? 20 : 6}
                    height={6}
                    borderRadius={3}
                    backgroundColor={
                      bannerIndex === i ? 'primary700' : isDark ? 'gray800' : 'gray200'
                    }
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* Connected Apps */}
          {!q && connectedApps.length > 0 && (
            <Box mb="xl">
              <Text variant="p7" color="textSecondary" mb="m">
                Connected Apps
              </Text>
              {connectedApps.map((app) => (
                <ConnectedAppRow key={app.topic} {...app} onDisconnect={handleDisconnect} />
              ))}
            </Box>
          )}

          {/* Recommended dApps */}
          {filteredDapps.length > 0 && (
            <Box mb="xl">
              <Text variant="p7" color="textSecondary" mb="m">
                Recommended dApps
              </Text>
              {filteredDapps.map((dapp) => (
                <Box
                  key={dapp.id}
                  backgroundColor="bg900"
                  borderRadius={18}
                  padding="m"
                  flexDirection="row"
                  alignItems="center"
                  mb="s"
                >
                  <Box
                    width={44}
                    height={44}
                    borderRadius={12}
                    backgroundColor="bg800"
                    justifyContent="center"
                    alignItems="center"
                    mr="m"
                  >
                    <Image source={dapp.icon} style={{ width: 24, height: 24 }} />
                  </Box>
                  <Box flex={1}>
                    <Text variant="h10" color="textPrimary">
                      {dapp.name}
                    </Text>
                    <Text variant="p8" color="textSecondary">
                      {dapp.description}
                    </Text>
                  </Box>
                  <TouchableOpacity onPress={() => Linking.openURL(dapp.url)}>
                    <Text variant="p7" color="primary" style={{ fontWeight: '600' }}>
                      Open
                    </Text>
                  </TouchableOpacity>
                </Box>
              ))}
            </Box>
          )}

          {/* Trending Assets */}
          {filteredTokens.length > 0 && (
            <Box>
              <Text variant="p7" color="textSecondary" mb="m">
                Trending
              </Text>
              {filteredTokens.map((token) => (
                <TokenRow key={token.code} {...token} isDark={isDark} />
              ))}
            </Box>
          )}

          {q && filteredDapps.length === 0 && filteredTokens.length === 0 && (
            <Box alignItems="center" mt="xl">
              <Text variant="p7" color="textSecondary">
                No results for &ldquo;{search}&rdquo;
              </Text>
            </Box>
          )}
        </Box>
      </ScrollView>
    </Box>
  );
};


export default Explore;
