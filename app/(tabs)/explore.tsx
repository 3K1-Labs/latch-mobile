import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import TokenIcon from '@/src/components/shared/TokenIcon';
import { getWellKnownTokens } from '@/src/constants/known-tokens';
import { useTabBarScroll } from '@/src/context/tab-bar-scroll';
import { usePrices } from '@/src/hooks/use-prices';
import { useDisplayFiat } from '@/src/hooks/use-display-fiat';
import { useTokenIcon } from '@/src/hooks/use-token-list';
import { disconnectSession, getActiveSessions } from '@/src/lib/walletconnect';
import { useWalletConnectStore } from '@/src/store/walletconnect';
import { Theme } from '@/src/theme/theme';
import { UNPRICED_LABEL } from '@/src/utils/format-fiat';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Dimensions,
  FlatList,
  ImageSourcePropType,
  Linking,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ICONS = {
  search: require('@/src/assets/images/swap/search.svg'),
  chevron: require('@/src/assets/images/explore/row-chevron.svg'),
};

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

const POSITIVE = '#27C11F';

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

const ListCard = ({ children }: { children: React.ReactNode }) => (
  <Box
    flexDirection="row"
    alignItems="center"
    backgroundColor="inputBox"
    borderColor="inputOutline"
    borderWidth={1}
    borderRadius={16}
    style={styles.card}
  >
    {children}
  </Box>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Box style={styles.section}>
    <Text fontSize={16} lineHeight={20} letterSpacing={0.16} fontFamily="SFproMedium" color="textPrimary">
      {title}
    </Text>
    <Box style={styles.list}>{children}</Box>
  </Box>
);

const RowText = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <Box flex={1}>
    <Text fontSize={16} lineHeight={24} letterSpacing={0.32} color="textPrimary" numberOfLines={1}>
      {title}
    </Text>
    <Text fontSize={14} lineHeight={22} color="textSubheading" numberOfLines={1}>
      {subtitle}
    </Text>
  </Box>
);

interface TokenRowProps {
  code: string;
  name: string;
  issuer?: string;
  /** Undefined when the token has no quote — the row shows UNPRICED_LABEL. */
  price?: string;
  change?: number;
}

function TokenRow({ code, name, issuer, price, change }: TokenRowProps) {
  const theme = useTheme<Theme>();
  const iconUrl = useTokenIcon(code, issuer);
  const { formatUsdValue } = useDisplayFiat();

  return (
    <ListCard>
      <Box width={40} height={40} borderRadius={20} overflow="hidden">
        <TokenIcon iconUrl={iconUrl} size={40} />
      </Box>
      <Box flex={1} style={styles.tokenCol}>
        <Text fontSize={16} lineHeight={24} letterSpacing={0.32} color="textPrimary" numberOfLines={1}>
          {name}
        </Text>
        <Text fontSize={12} lineHeight={24} letterSpacing={0.24} color="textSubheading">
          {code}
        </Text>
      </Box>
      <Box alignItems="flex-end" style={styles.tokenCol}>
        <Text
          fontSize={16}
          lineHeight={24}
          letterSpacing={0.32}
          fontFamily="SFproMedium"
          color="textPrimary"
        >
          {formatPrice(price, formatUsdValue)}
        </Text>
        {change != null && (
          <Text
            fontSize={12}
            lineHeight={24}
            letterSpacing={0.24}
            fontFamily="SFproMedium"
            style={{ color: change >= 0 ? POSITIVE : theme.colors.danger900 }}
          >
            {formatChange(change)}
          </Text>
        )}
      </Box>
    </ListCard>
  );
}

function DappRow({
  name,
  description,
  url,
  icon,
}: {
  name: string;
  description: string;
  url: string;
  icon: ImageSourcePropType;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="link"
      accessibilityLabel={`Open ${name}`}
      activeOpacity={0.7}
      onPress={() => Linking.openURL(url)}
    >
      <ListCard>
        <Image source={icon} style={styles.logo} />
        <RowText title={name} subtitle={description} />
        <Image source={ICONS.chevron} tintColor="#706F6F" style={styles.chevron} />
      </ListCard>
    </TouchableOpacity>
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
  const theme = useTheme<Theme>();
  return (
    <ListCard>
      <Box
        width={40}
        height={40}
        borderRadius={20}
        backgroundColor="inputOutline"
        justifyContent="center"
        alignItems="center"
        overflow="hidden"
      >
        {icon ? (
          <Image source={{ uri: icon }} style={styles.logo} contentFit="cover" />
        ) : (
          <Text fontSize={16} lineHeight={24} color="textMuted">
            {name[0]?.toUpperCase() ?? '?'}
          </Text>
        )}
      </Box>
      <RowText title={name} subtitle={url} />
      <TouchableOpacity onPress={() => onDisconnect(topic)} hitSlop={8}>
        <Text
          fontSize={14}
          lineHeight={22}
          fontFamily="SFproMedium"
          style={{ color: theme.colors.danger900 }}
        >
          Disconnect
        </Text>
      </TouchableOpacity>
    </ListCard>
  );
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const Explore = () => {
  const theme = useTheme<Theme>();
  const statusBarStyle = useStatusBarStyle();
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
    <Box flex={1} backgroundColor="surfaceBase" style={{ paddingTop: insets.top }}>
      <StatusBar style={statusBarStyle} />

      <Box flexDirection="row" alignItems="center" justifyContent="space-between" style={styles.header}>
        <Text fontSize={20} lineHeight={28} fontFamily="SFproMedium" color="textPrimary">
          Explore
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Scan QR code"
          activeOpacity={0.7}
          onPress={() => router.push('/qrcode-scan')}
        >
          <Box
            width={36}
            height={36}
            borderRadius={18}
            backgroundColor="inputOutline"
            justifyContent="center"
            alignItems="center"
          >
            <MaterialCommunityIcons name="qrcode-scan" size={18} color={theme.colors.textPrimary} />
          </Box>
        </TouchableOpacity>
      </Box>

      <ScrollView
        {...tabBarScroll}
        style={styles.fill}
        showsVerticalScrollIndicator={false}
        bounces={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
      >
        <Box
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
            placeholder="Search for Trending dApps or assets..."
            placeholderTextColor={theme.colors.textMuted}
            autoCorrect={false}
            autoCapitalize="none"
            style={[styles.searchInput, { color: theme.colors.textPrimary }]}
          />
        </Box>

        {!q && (
          <Box style={styles.banners}>
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
                  <Box width={SCREEN_WIDTH - 48} height={100} overflow="hidden" borderRadius={20}>
                    <Image source={item.image} contentFit="cover" style={styles.fill} />
                  </Box>
                </Box>
              )}
            />
            <Box flexDirection="row" justifyContent="center" style={styles.dots}>
              {banners.map((banner, i) => (
                <Box
                  key={banner.id}
                  width={bannerIndex === i ? 12 : 6}
                  height={6}
                  borderRadius={3}
                  style={{
                    backgroundColor: bannerIndex === i ? '#FFC508' : theme.colors.dotInactive,
                  }}
                />
              ))}
            </Box>
          </Box>
        )}

        {!q && connectedApps.length > 0 && (
          <Section title="Connected Apps">
            {connectedApps.map((app) => (
              <ConnectedAppRow key={app.topic} {...app} onDisconnect={handleDisconnect} />
            ))}
          </Section>
        )}

        {filteredDapps.length > 0 && (
          <Section title="Recommended dApps">
            {filteredDapps.map((dapp) => (
              <DappRow key={dapp.id} {...dapp} />
            ))}
          </Section>
        )}

        {filteredTokens.length > 0 && (
          <Section title="Trending">
            {filteredTokens.map((token) => (
              <TokenRow key={token.code} {...token} />
            ))}
          </Section>
        )}

        {q && filteredDapps.length === 0 && filteredTokens.length === 0 && (
          <Box alignItems="center" style={styles.section}>
            <Text fontSize={14} lineHeight={22} color="textSubheading">
              No results for &ldquo;{search}&rdquo;
            </Text>
          </Box>
        )}
      </ScrollView>
    </Box>
  );
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  header: {
    height: 64,
    marginTop: 4,
    paddingHorizontal: 24,
  },
  search: {
    marginTop: 8,
    marginHorizontal: 24,
    height: 48,
    paddingHorizontal: 20,
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
    // Without an explicit lineHeight the bundled SF Pro sits below centre in an
    // iOS TextInput, clipping the placeholder.
    lineHeight: 18,
    fontFamily: 'SFproRegular',
  },
  banners: {
    marginTop: 16,
  },
  dots: {
    marginTop: 8,
    gap: 4,
  },
  section: {
    marginTop: 32,
    paddingHorizontal: 24,
  },
  list: {
    marginTop: 20,
    gap: 12,
  },
  card: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 14,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  chevron: {
    width: 12,
    height: 24,
  },
  tokenCol: {
    gap: 2,
  },
});

export default Explore;
