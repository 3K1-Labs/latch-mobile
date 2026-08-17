import { isDepositIntentExpired, ONRAMP_INTENT_TTL_SECONDS } from '@/src/api/latch-auth';
import HistoryItem from '@/src/components/history/HistoryItem';
import BuyXLMSheet from '@/src/components/home/BuyXLMSheet';
import FundWalletSheet from '@/src/components/home/FundWalletSheet';
import PendingApprovalBanner from '@/src/components/home/PendingApprovalBanner';
import Box from '@/src/components/shared/Box';
import Skeleton from '@/src/components/shared/Skeleton';
import Text from '@/src/components/shared/Text';
import TokenIcon from '@/src/components/shared/TokenIcon';
import { getNetworkId } from '@/src/constants/config';
import { useDrawer } from '@/src/context/drawer-context';
import { useTabBarScroll } from '@/src/context/tab-bar-scroll';
import { useCreateDepositIntent } from '@/src/hooks/use-deposit';
import { usePortfolio, type TokenBalance } from '@/src/hooks/use-portfolio';
import { usePrices } from '@/src/hooks/use-prices';
import { StellarPayment, useStellarTransactions } from '@/src/hooks/use-stellar-transactions';
import { useTokenIcon } from '@/src/hooks/use-token-list';
import { useTrackedTokens } from '@/src/hooks/use-tracked-tokens';
import { discoverMigration } from '@/src/lib/migration';
import { useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { calculatePortfolio24hChangeFormatted, getTotalUSDBalance } from '@/src/utils';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ImageBackground } from 'expo-image';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { memo, useMemo, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  RefreshControl,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function RaysBackgroundInner() {
  return (
    <Box position="absolute" style={{ top: -30, left: '28%' }}>
      <ImageBackground
        source={require('@/src/assets/icon/Circle.png')}
        style={{ position: 'absolute', width: 182, height: 182 }}
      />
    </Box>
  );
}
const RaysBackground = memo(RaysBackgroundInner);

const banners = [
  { id: 1, image: require('@/src/assets/banners/smart-accounts.png') },
  { id: 2, image: require('@/src/assets/banners/multisig.png') },
  { id: 3, image: require('@/src/assets/banners/swap.png') },
  { id: 4, image: require('@/src/assets/banners/session-keys.png') },
];

function TokenRow({
  token,
  showBalance,
  isDark,
  theme,
}: {
  token: TokenBalance;
  showBalance: boolean;
  isDark: boolean;
  theme: Theme;
}) {
  const iconUrl = useTokenIcon(token.code, token.issuer);
  const amount = parseFloat(token.amount);
  const formattedAmount = amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: token.code === 'XLM' ? 7 : 2,
  });
  const formattedUsd = token.usdValue.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      backgroundColor={'bg11'}
      padding="m"
      borderRadius={20}
      mb="s"
      style={
        !isDark
          ? {
              borderWidth: 1,
              borderColor: '#F5F5F5',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.05,
              shadowRadius: 4,
              elevation: 2,
            }
          : {}
      }
    >
      <Box backgroundColor={isDark ? 'black' : 'text400'} borderRadius={24} mr="m">
        <TokenIcon iconUrl={iconUrl} size={48} />
      </Box>
      <Box flex={1}>
        <Text variant="h11" color="textPrimary" fontWeight="700">
          {token.code}
        </Text>
        <Text variant="p8" color="textSecondary" mt="xs">
          {token.code === 'XLM' ? 'Stellar Lumens' : token.code}
        </Text>
      </Box>
      <Box alignItems="flex-end">
        <Text variant="h11" color="textPrimary" fontWeight="700">
          {showBalance ? `${formattedAmount} ${token.code}` : '****'}
        </Text>
        <Text variant="p8" color="textSecondary" mt="xs">
          {showBalance ? `$${formattedUsd}` : '****'}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Convert the fiat amount the user entered into the XLM figure the relayer
 * expects on an intent's `expected_amt`.
 *
 * The on-ramp screen collects USD (MoonPay's baseCurrencyAmount) but the
 * relayer compares expected_amt against what actually lands in the pool, which
 * is XLM — handing it a dollar figure would flag a mismatch on every single
 * deposit, which is worse than sending nothing.
 *
 * Necessarily an estimate: it's the GROSS fiat figure, so the provider's card
 * and network fees mean the XLM that actually arrives is meaningfully lower,
 * and the price moves between checkout and settlement. That's tolerable because
 * expected_amt is advisory — the relayer logs a mismatch but still credits the
 * deposit — and an order-of-magnitude sanity check is the point.
 *
 * Returns undefined rather than a wrong number when either input is unusable,
 * since the field is optional and an omitted estimate beats a bogus one.
 */
function estimateXlmForFiat(fiatAmount?: string, xlmUsdPrice?: string): string | undefined {
  if (!fiatAmount || !xlmUsdPrice) return undefined;
  const fiat = parseFloat(fiatAmount);
  const price = parseFloat(xlmUsdPrice);
  if (!Number.isFinite(fiat) || fiat <= 0) return undefined;
  if (!Number.isFinite(price) || price <= 0) return undefined;
  return (fiat / price).toFixed(7);
}

const Home = () => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  // const statusBarStyle = useStatusBarStyle();
  const insets = useSafeAreaInsets();
  const tabBarScroll = useTabBarScroll();

  const { smartAccountAddress, accounts, activeAccountIndex, mnemonic, avatars } = useWalletStore();
  const [showBalance, setShowBalance] = useState(false);
  const [bannerIndex, setBannerIndex] = useState(0);
  const [fundVisible, setFundVisible] = useState(false);
  const [receiveVisible, setReceiveVisible] = useState(false);

  const createDepositIntent = useCreateDepositIntent();

  // A minted intent is only usable on the network it was minted against, and
  // only while it belongs to the account on screen and its TTL hasn't elapsed.
  // Once any of those fails the memo must not be shown: the relayer sweeps
  // deposits carrying an expired or unknown memo_id to its recovery address
  // instead of crediting the user.
  //
  // A mutation result outlives a network switch — useMutation's observer holds
  // the mutation directly, so neither queryClient.clear() nor resetQueries()
  // drops it — so without the mintedOn check an intent stays "live" after
  // switching away, and the sheets would hand a provider a pool address nobody
  // is watching on the network the user is now on.
  const depositIntent =
    createDepositIntent.data?.mintedOn === getNetworkId() &&
    createDepositIntent.data &&
    createDepositIntent.variables?.smartAccountAddress === smartAccountAddress &&
    !isDepositIntentExpired(createDepositIntent.data.expires_at)
      ? createDepositIntent.data
      : undefined;

  // Mint only when there isn't already a live intent. Re-minting on every Fund
  // press would orphan a memo the user may have already copied into a sending
  // wallet — the old intent stays valid until its TTL, but the status sheet
  // would then be polling the wrong memo_id.
  //
  // Whether the active network has a relayer is the backend's call, not a
  // build-time constant here: it answers 400 "funding is only available on
  // testnet" when RELAYER_URL_MAINNET is unset, and starts minting the moment
  // it is — with no new app build. A rejected mint leaves depositIntent
  // undefined, so the sheets fall back to the direct C-address path exactly as
  // they did when this was gated client-side.
  //
  // Names whichever guard stopped a mint, or null when one should go ahead.
  // Every early exit below is invisible from the outside — the sheet just opens
  // with no memo, and one of them (reusing a still-live intent) is correct
  // behaviour that looks identical to a bug in a network inspector. Without this,
  // "the deposit endpoint wasn't called" can't be told apart from an unhydrated
  // store or an in-flight mint.
  // Carries the address rather than just a boolean so the null check narrows for
  // the caller — mutate() takes a plain string.
  const depositMintPlan = (): { address: string } | { skip: string } => {
    if (!smartAccountAddress) return { skip: 'no smart account address yet' };
    if (depositIntent) {
      return {
        skip: `reusing live intent memo=${depositIntent.memo_id} expires=${depositIntent.expires_at}`,
      };
    }
    if (createDepositIntent.isPending) return { skip: 'a mint is already in flight' };
    return { address: smartAccountAddress };
  };

  const ensureDepositIntent = () => {
    const plan = depositMintPlan();
    if ('skip' in plan) {
      if (__DEV__) console.log('[deposit] no mint —', plan.skip);
      return;
    }
    if (__DEV__) console.log('[deposit] minting intent for', plan.address);
    createDepositIntent.mutate({ smartAccountAddress: plan.address });
  };

  // The Fund-sheet intent above is minted at the backend's default 1h TTL, which
  // suits someone about to paste an address into a wallet they already hold funds
  // in. An on-ramp is a different bet: card purchases usually settle inside the
  // hour, but a bank transfer can take days, and an expired memo_id is swept to
  // recovery just like an unknown one. So re-mint with a long TTL at the moment
  // the user actually commits to a provider, rather than widening the window for
  // every deposit.
  //
  // Returns undefined on failure so the caller can fall back to the intent it
  // already holds instead of opening a provider with no tag at all.
  //
  // fiatAmount is what the user typed on the amount screen (USD). expected_amt
  // is denominated in the deposited asset, so it's converted here rather than
  // passed straight through — see estimateXlmForFiat.
  const prepareOnrampIntent = async (fiatAmount?: string) => {
    if (!smartAccountAddress) {
      if (__DEV__) console.log('[deposit] no on-ramp mint — no smart account address yet');
      return undefined;
    }
    const expectedAmt = pricesArePlaceholder
      ? undefined
      : estimateXlmForFiat(fiatAmount, prices?.XLM?.price);
    if (__DEV__) {
      console.log('[deposit] minting on-ramp intent', { fiatAmount, expectedAmt });
    }
    try {
      return await createDepositIntent.mutateAsync({
        smartAccountAddress,
        expiresIn: ONRAMP_INTENT_TTL_SECONDS,
        expectedAmt,
      });
    } catch (err) {
      // Swallowed so the caller can fall back to the intent it already holds,
      // but the reason has to surface somewhere — a failed mint here is why a
      // provider would open with no tag at all.
      if (__DEV__) console.log('[deposit] on-ramp mint failed —', err);
      return undefined;
    }
  };

  const activeAccount = accounts[activeAccountIndex];
  const activeAccountName = activeAccount?.name ?? 'Account 1';
  const activeAccountImage = activeAccount ? avatars[activeAccount.publicKeyHex] : undefined;

  const { openDrawer } = useDrawer();

  const { tokens: trackedTokens } = useTrackedTokens();

  const {
    data: prices,
    refetch: refetchPrices,
    isPlaceholderData: pricesArePlaceholder,
  } = usePrices();
  // No blocking overlay on either of these. Both render their own section
  // state, so balances are usable while the (far slower) history scan is still
  // running, and a cold start paints the last known values immediately from the
  // persisted snapshot instead of a spinner.
  const {
    data: portfolio,
    isLoading: portfolioLoading,
    isFetching: portfolioFetching,
    isError: portfolioError,
    refetch: refetchPortfolio,
    snapshotAt: portfolioSnapshotAt,
  } = usePortfolio(smartAccountAddress, activeAccount?.gAddress, trackedTokens);

  const {
    data: transactions,
    refetch: refetchTx,
    isLoading: txLoading,
  } = useStellarTransactions(smartAccountAddress);

  const { data: migrationState } = useQuery({
    queryKey: ['migration-state', smartAccountAddress, activeAccount?.gAddress],
    queryFn: () => discoverMigration(activeAccount!),
    enabled: !!activeAccount?.gAddress && !!smartAccountAddress && !!mnemonic,
    staleTime: 60_000,
  });

  const balanceStatus = portfolioError
    ? 'Could not refresh — showing last known'
    : portfolioSnapshotAt
      ? `As of ${format(new Date(portfolioSnapshotAt), 'MMM d, HH:mm')}`
      : portfolioFetching && !portfolioLoading
        ? 'Updating…'
        : null;

  const [manualRefreshing, setManualRefreshing] = useState(false);

  const handleRefresh = async () => {
    setManualRefreshing(true);
    await Promise.all([refetchPrices(), refetchPortfolio(), refetchTx()]);
    setManualRefreshing(false);
  };

  const livePrices = useMemo<Record<string, any>>(() => prices ?? {}, [prices]);
  const totalUsd = useMemo(
    () => getTotalUSDBalance({ portfolio, livePrices }),
    [portfolio, livePrices],
  );

  const dayChange = useMemo(() => {
    return calculatePortfolio24hChangeFormatted({
      prices: livePrices,
      portfolio: portfolio as TokenBalance[],
    });
  }, [portfolio, livePrices]);

  // Tint the 24h badge by direction. Null when flat (or when the balance is
  // hidden) so it falls back to the neutral chip rather than claiming a gain of
  // exactly 0.00% is "up". dayChange is a toFixed string, so parse before
  // comparing — '-0.00' and '0.00' both land on 0 and stay neutral.
  const dayChangeTint = useMemo(() => {
    const value = parseFloat(dayChange);
    if (!showBalance || !Number.isFinite(value) || value === 0) return null;
    return value > 0
      ? { background: 'rgba(0,199,53,0.16)', text: theme.colors.success600 }
      : { background: 'rgba(254,95,56,0.16)', text: theme.colors.danger900 };
  }, [dayChange, showBalance, theme.colors.success600, theme.colors.danger900]);

  const xlmToken = useMemo(() => portfolio?.find((t) => t.code === 'XLM'), [portfolio]);
  const spendableXlm = useMemo(() => parseFloat(xlmToken?.amount ?? '0') || 0, [xlmToken]);
  const recentTx = useMemo(() => transactions?.slice(0, 3) ?? [], [transactions]);

  const handleRowPress = (tx: StellarPayment) => {
    const isSent = tx.from === smartAccountAddress;
    const direction = isSent ? 'sent' : 'received';

    router.push({
      pathname: '/transaction/[id]',
      params: {
        id: tx.id,
        hash: tx.transactionHash,
        type: tx.type,
        from: tx.from,
        to: tx.to,
        amount: tx.amount,
        assetType: tx.assetType,
        assetCode: tx.assetCode ?? 'XLM',
        createdAt: tx.createdAt,
        direction,
        gAddress: tx.from,
      },
    });
  };

  return (
    <Box flex={1} backgroundColor="onboardingbg">
      <StatusBar style={'light'} />
      {/* Header */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        paddingHorizontal="m"
        style={{ paddingTop: insets.top + 8 }}
        mb="m"
      >
        <TouchableOpacity activeOpacity={0.7} onPress={openDrawer}>
          <Box
            flexDirection="row"
            alignItems="center"
            backgroundColor={isDark ? 'gray900' : 'gray100'}
            borderRadius={100}
            paddingVertical="xs"
            paddingHorizontal="s"
            gap="s"
            style={!isDark ? { borderWidth: 1, borderColor: '#F0F0F0' } : {}}
          >
            <Box
              width={32}
              height={32}
              borderRadius={16}
              backgroundColor="primary700"
              justifyContent="center"
              alignItems="center"
              overflow={'hidden'}
            >
              {activeAccountImage ? (
                <Image source={{ uri: activeAccountImage }} style={{ width: 32, height: 32 }} />
              ) : (
                <Text variant="p7" color="textWhite" fontWeight="700">
                  {activeAccountName.charAt(0)}
                </Text>
              )}
            </Box>
            <Text variant="h11" color="textPrimary" fontWeight="700">
              {activeAccountName}
            </Text>
            <Ionicons name="chevron-down" size={14} color={theme.colors.textPrimary} />
          </Box>
        </TouchableOpacity>

        <Box flexDirection="row" gap="m">
          <TouchableOpacity>
            <Ionicons
              name="search-outline"
              size={24}
              color={isDark ? theme.colors.bgDark700 : theme.colors.bgDark100}
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/qrcode-scan')}>
            <MaterialCommunityIcons
              name="qrcode-scan"
              size={24}
              color={isDark ? theme.colors.bgDark700 : theme.colors.bgDark100}
            />
          </TouchableOpacity>
        </Box>
      </Box>

      <ScrollView
        {...tabBarScroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={manualRefreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary700}
          />
        }
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        <PendingApprovalBanner />

        {/* Balance Section */}
        <Box alignItems="center" pb="xl" position="relative" mt="xl">
          {!isDark && <RaysBackground />}
          <TouchableOpacity
            onPress={() => setShowBalance(!showBalance)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}
          >
            <Text variant="p7" color="textSecondary" fontWeight="600">
              Total Balance
            </Text>
            <Ionicons
              name={showBalance ? 'eye-outline' : 'eye-off-outline'}
              size={14}
              color={theme.colors.textSecondary}
            />
          </TouchableOpacity>

          {portfolioLoading ? (
            <Box my="s">
              <Skeleton width={180} height={38} borderRadius={10} />
            </Box>
          ) : (
            <Text variant="h5" color="textPrimary" style={{ fontWeight: '700', letterSpacing: -1 }}>
              {!showBalance
                ? '***'
                : // No figure at all beats a fabricated one: with nothing fetched
                  // and nothing cached, "$0.00" would read as an empty wallet.
                  portfolio
                  ? `$${totalUsd.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`
                  : '—'}
            </Text>
          )}

          <Box flexDirection="row" alignItems="center" gap="s" mt="xs">
            <Text variant="p7" color="textSecondary" fontWeight="600">
              {showBalance
                ? `${spendableXlm.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 7,
                  })} XLM`
                : '****'}
            </Text>
            <Box
              backgroundColor={isDark ? 'gray900' : 'gray100'}
              borderRadius={6}
              paddingHorizontal="s"
              justifyContent={'center'}
              alignItems={'center'}
              paddingVertical="xs"
              style={
                dayChangeTint
                  ? { backgroundColor: dayChangeTint.background }
                  : !isDark
                    ? { borderWidth: 1, borderColor: '#F0F0F0' }
                    : {}
              }
            >
              <Text
                variant="p7"
                color="textPrimary"
                fontWeight="700"
                style={dayChangeTint ? { color: dayChangeTint.text } : undefined}
              >
                {showBalance ? `${dayChange ?? 0.0}%` : '****'}
              </Text>
            </Box>
          </Box>

          {/* Freshness, not a spinner. A background refresh has to be visible
              without blocking, and a persisted snapshot must never pass for a
              live figure. */}
          {balanceStatus && (
            <Text variant="p8" color="textSecondary" mt="xs">
              {balanceStatus}
            </Text>
          )}
        </Box>

        {/* Action Buttons */}
        <Box flexDirection="row" justifyContent="space-around" paddingHorizontal="m" mb="xl" mt="m">
          {[
            { label: 'Fund', icon: require('@/src/assets/icon/plus-big.png') },
            { label: 'Send', icon: require('@/src/assets/icon/ArrowUp.png'), route: '/send-token' },
            {
              label: 'Receive',
              icon: require('@/src/assets/icon/arrowDown.png'),
              route: '/receive-token',
            },
            {
              label: 'Swap',
              icon: require('@/src/assets/icon/RepeatGold.png'),
            },
          ].map((item, index) => (
            <Box key={index} alignItems="center" gap="s">
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => {
                  if (item.label === 'Fund') {
                    setFundVisible(true);
                    ensureDepositIntent();
                  } else if (item.label === 'Swap') {
                    // Swap is a tab, not a stacked screen — navigate() switches
                    // to it (matching the tab bar) instead of pushing a second
                    // copy on top of Home with no way back to the tab bar.
                    router.navigate('/swap');
                  } else if ('route' in item && item.route) {
                    router.push(item.route as any);
                  }
                }}
              >
                <Box
                  width={68}
                  height={68}
                  borderRadius={34}
                  backgroundColor={isDark ? 'gray900' : 'gray100'}
                  justifyContent="center"
                  alignItems="center"
                >
                  <Image
                    source={item.icon}
                    style={{ width: 28, height: 28 }}
                    resizeMode="contain"
                    tintColor={
                      index === 3 ? undefined : isDark ? theme.colors.primary700 : '#FFAD00'
                    }
                  />
                </Box>
              </TouchableOpacity>
              <Text variant="p7" color="bgDark600">
                {item.label}
              </Text>
            </Box>
          ))}
        </Box>

        {/* Your Assets */}
        {(portfolio ?? []).length > 0 && (
          <Box paddingHorizontal="m" mb="xl">
            <Box flexDirection="row" justifyContent="space-between" alignItems="center" mb="m">
              <Text variant="h9" color="textPrimary" fontWeight="700">
                Your Assets
              </Text>
              <TouchableOpacity onPress={() => router.push('/add-token')}>
                <Text variant="p7" color="primary700" fontWeight="700">
                  Manage
                </Text>
              </TouchableOpacity>
            </Box>
            {(portfolio ?? []).map((token) => {
              const usd = parseFloat(token.amount) * (livePrices[token.code]?.price || 0);
              return (
                <TokenRow
                  key={token.code + (token.issuer ?? '')}
                  token={{ ...token, usdValue: isNaN(usd) ? 0 : usd }}
                  showBalance={showBalance}
                  isDark={isDark}
                  theme={theme}
                />
              );
            })}
          </Box>
        )}

        {/* Banner Carousel */}
        <Box mb="xl">
          <FlatList
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            data={banners}
            onScroll={(e) => {
              const x = e.nativeEvent.contentOffset.x;
              const index = Math.round(x / SCREEN_WIDTH);
              setBannerIndex(index);
            }}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => (
              <Box width={SCREEN_WIDTH} alignItems="center" justifyContent="center">
                <Box width={SCREEN_WIDTH - 32} height={101} overflow={'hidden'} borderRadius={12}>
                  <Image
                    source={item.image}
                    style={{ height: '100%', width: '100%' }}
                    resizeMode="cover"
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
                backgroundColor={bannerIndex === i ? 'primary700' : isDark ? 'gray800' : 'gray200'}
              />
            ))}
          </Box>
        </Box>

        {/* Migration banner */}
        {migrationState?.state === 'not_started' && (
          <Box paddingHorizontal="m" mb="m">
            <TouchableOpacity activeOpacity={0.85} onPress={() => router.push('/(migration)')}>
              <Box
                borderRadius={16}
                padding="m"
                flexDirection="row"
                alignItems="center"
                gap="m"
                style={{
                  backgroundColor: isDark ? '#2C2000' : '#FFFBEB',
                  borderWidth: 1,
                  borderColor: isDark ? '#4A3800' : '#FFE58F',
                }}
              >
                <Box
                  width={40}
                  height={40}
                  borderRadius={20}
                  backgroundColor="primary700"
                  justifyContent="center"
                  alignItems="center"
                >
                  <Ionicons name="swap-horizontal" size={20} color="#000" />
                </Box>
                <Box flex={1}>
                  <Text
                    variant="h11"
                    fontWeight="700"
                    style={{ color: isDark ? '#FFD666' : '#874D00' }}
                  >
                    Assets on classic account
                  </Text>
                  <Text variant="p8" style={{ color: isDark ? '#B8860B' : '#AD6800' }} mt="xs">
                    Tap to migrate them to your smart account
                  </Text>
                </Box>
                <Ionicons name="chevron-forward" size={16} color={isDark ? '#B8860B' : '#AD6800'} />
              </Box>
            </TouchableOpacity>
          </Box>
        )}

        {/* Recent Activity */}
        <Box paddingHorizontal="m">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" mb="m">
            <Text variant="h9" color="textPrimary" fontWeight="700">
              Recent Activity
            </Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/history')}>
              <Text variant="p7" color="primary700" fontWeight="700">
                View All
              </Text>
            </TouchableOpacity>
          </Box>

          {/* The history scan is much slower than the balance fetch, so it gets
              its own state here rather than holding the screen. "No transactions
              found" is only the truth once a fetch has actually completed —
              while one is still running it would be a guess. */}
          {txLoading ? (
            <Box>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} width="100%" height={64} borderRadius={16} mb="s" />
              ))}
            </Box>
          ) : recentTx.length === 0 ? (
            <Box
              py="xl"
              alignItems="center"
              backgroundColor={isDark ? 'gray900' : 'gray100'}
              borderRadius={16}
            >
              <Text color="textSecondary" variant="p7">
                No transactions found
              </Text>
            </Box>
          ) : (
            recentTx.map((tx) => (
              <HistoryItem
                key={tx.id}
                item={tx}
                smartAccountAddress={smartAccountAddress}
                handleRowPress={handleRowPress}
              />
            ))
          )}
        </Box>
      </ScrollView>

      <BuyXLMSheet
        visible={fundVisible}
        onClose={() => setFundVisible(false)}
        onReceive={() => {
          setFundVisible(false);
          setReceiveVisible(true);
        }}
        poolAddress={depositIntent?.pool_address ?? ''}
        memo={depositIntent?.memo_id}
        prepareOnrampIntent={prepareOnrampIntent}
      />
      <FundWalletSheet
        visible={receiveVisible}
        onClose={() => setReceiveVisible(false)}
        cAddress={smartAccountAddress ?? ''}
        proxyAddress={depositIntent?.pool_address}
        memo={depositIntent?.memo_id}
        memoExpiresAt={depositIntent?.expires_at}
      />
    </Box>
  );
};

export default Home;
