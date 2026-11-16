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
import { useDisplayFiat } from '@/src/hooks/use-display-fiat';
import { usePortfolio, type TokenBalance } from '@/src/hooks/use-portfolio';
import { usePrices } from '@/src/hooks/use-prices';
import { StellarPayment, useStellarTransactions } from '@/src/hooks/use-stellar-transactions';
import { useTokenIcon } from '@/src/hooks/use-token-list';
import { useTrackedTokens } from '@/src/hooks/use-tracked-tokens';
import { discoverMigration } from '@/src/lib/migration';
import { useNotificationStore } from '@/src/store/notification-store';
import { avatarKey, useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import {
  calculatePortfolio24hChangeFormatted,
  getTotalUSDBalance,
  shortenAddress,
} from '@/src/utils';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ICONS = {
  bell: require('@/src/assets/images/home/bell.svg'),
  copy: require('@/src/assets/images/home/copy.svg'),
  eye: require('@/src/assets/images/home/eye.svg'),
  eyeOff: require('@/src/assets/images/home/eye-off.svg'),
  chevron: require('@/src/assets/images/home/chevron.svg'),
  emptyMascot: require('@/src/assets/images/home/empty-mascot.svg'),
};

const ACTIONS = [
  { label: 'Fund', icon: require('@/src/assets/images/home/plus.svg') },
  { label: 'Send', icon: require('@/src/assets/images/home/send.svg'), route: '/send-token' },
  {
    label: 'Receive',
    icon: require('@/src/assets/images/home/receive.svg'),
    route: '/receive-token',
  },
  { label: 'Swap', icon: require('@/src/assets/images/home/swap.svg') },
];

const SectionHeader = ({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) => (
  <Box flexDirection="row" justifyContent="space-between" alignItems="center" mb="m">
    <Text variant="p6" fontFamily="SFproMedium" lineHeight={20} letterSpacing={0.16} color="textPrimary">
      {title}
    </Text>
    {action && (
      <TouchableOpacity onPress={onPress} hitSlop={8} style={styles.sectionAction}>
        <Text variant="p7" lineHeight={20} letterSpacing={0.14} color="textSubheading">
          {action}
        </Text>
        <Image source={ICONS.chevron} contentFit="contain" style={styles.chevron} />
      </TouchableOpacity>
    )}
  </Box>
);

const banners = [
  { id: 1, image: require('@/src/assets/banners/smart-accounts.png') },
  { id: 2, image: require('@/src/assets/banners/multisig.png') },
  { id: 3, image: require('@/src/assets/banners/swap.png') },
  { id: 4, image: require('@/src/assets/banners/session-keys.png') },
];

function TokenRow({
  token,
  showBalance,
  fiatLabel,
}: {
  token: TokenBalance;
  showBalance: boolean;
  fiatLabel: string;
}) {
  const iconUrl = useTokenIcon(token.code, token.issuer);
  const amount = parseFloat(token.amount);
  // 7dp for every token, not just XLM — a non-native balance under 0.01 (e.g.
  // dust left over from a swap) otherwise rounds to the same "0.00" shown for
  // an empty wallet. minimumFractionDigits still pads a round number to 2dp,
  // so this is a no-op for ordinary balances.
  const formattedAmount = amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  });

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      gap="sm"
      backgroundColor="inputBox"
      borderWidth={1}
      borderColor="inputOutline"
      borderRadius={16}
      style={styles.tokenRow}
    >
      <Box borderRadius={16} overflow="hidden">
        <TokenIcon iconUrl={iconUrl} size={32} />
      </Box>
      <Box flex={1} gap="xs">
        <Text variant="p6" fontFamily="SFproMedium" lineHeight={24} letterSpacing={0} color="textPrimary">
          {token.code}
        </Text>
        <Text variant="p7" lineHeight={14} letterSpacing={0} color="textSubheading">
          {token.code === 'XLM' ? 'Stellar Lumens' : token.code}
        </Text>
      </Box>
      <Box alignItems="flex-end" gap="xs">
        <Text variant="p6" fontFamily="SFproSemibold" lineHeight={24} letterSpacing={0} color="textPrimary">
          {showBalance ? `${formattedAmount} ${token.code}` : '****'}
        </Text>
        <Text variant="p7" lineHeight={14} letterSpacing={0} color="textSubheading">
          {showBalance ? fiatLabel : '****'}
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
  const statusBarStyle = useStatusBarStyle();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
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
  const activeAccountImage = activeAccount ? avatars[avatarKey(activeAccount)] : undefined;

  const { openDrawer } = useDrawer();
  const unreadNotifications = useNotificationStore((s) => s.unreadCount);

  const { tokens: trackedTokens } = useTrackedTokens();

  const {
    data: prices,
    refetch: refetchPrices,
    isPlaceholderData: pricesArePlaceholder,
  } = usePrices();
  const { formatUsdValue, formatToken, usedFallback } = useDisplayFiat();
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
    <Box flex={1} backgroundColor="surfaceBase">
      <StatusBar style={statusBarStyle} />
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        paddingHorizontal="l"
        style={{ paddingTop: insets.top + 12 }}
      >
        <Box flexDirection="row" alignItems="center" gap="s" flexShrink={1}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Switch account"
            activeOpacity={0.7}
            onPress={openDrawer}
            style={styles.headerAccount}
          >
            <Box
              width={32}
              height={32}
              borderRadius={16}
              backgroundColor="primary700"
              justifyContent="center"
              alignItems="center"
              overflow="hidden"
            >
              {activeAccountImage ? (
                <Image source={{ uri: activeAccountImage }} style={styles.avatar} />
              ) : (
                <Text variant="p7" color="textWhite" fontWeight="700">
                  {activeAccountName.charAt(0)}
                </Text>
              )}
            </Box>
            <Box flexShrink={1} style={styles.headerText}>
              <Text
                variant="p8"
                lineHeight={14}
                letterSpacing={0.12}
                numberOfLines={1}
                style={styles.greeting}
              >
                Hi, {activeAccountName}
              </Text>
              <Text
                variant="p6"
                fontFamily="SFproMedium"
                lineHeight={24}
                letterSpacing={0}
                color="textPrimary"
              >
                {shortenAddress(smartAccountAddress)}
              </Text>
            </Box>
          </TouchableOpacity>
          {smartAccountAddress && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Copy wallet address"
              hitSlop={10}
              onPress={() => copyToClipboard(smartAccountAddress)}
              style={styles.copy}
            >
              <Image source={ICONS.copy} contentFit="contain" style={styles.copyIcon} />
            </TouchableOpacity>
          )}
        </Box>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          activeOpacity={0.7}
          onPress={() => router.push('/notification')}
        >
          <Box
            width={36}
            height={36}
            borderRadius={18}
            backgroundColor="inputOutline"
            justifyContent="center"
            alignItems="center"
          >
            <Image
              source={ICONS.bell}
              contentFit="contain"
              tintColor={theme.colors.iconPrimary}
              style={styles.bell}
            />
          </Box>
          {unreadNotifications > 0 && (
            <Box style={styles.unreadDot} backgroundColor="primary700" borderColor="surfaceBase" />
          )}
        </TouchableOpacity>
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

        <Box alignItems="center" style={styles.balance}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={showBalance ? 'Hide balance' : 'Show balance'}
            onPress={() => setShowBalance(!showBalance)}
            style={styles.balanceToggle}
          >
            <Image
              source={showBalance ? ICONS.eyeOff : ICONS.eye}
              contentFit="contain"
              style={styles.eye}
            />
            <Text variant="p8" fontFamily="SFproMedium" lineHeight={20} letterSpacing={0} color="textSubheading">
              Total Balance
            </Text>
          </TouchableOpacity>

          {portfolioLoading ? (
            <Box my="s">
              <Skeleton width={180} height={40} borderRadius={10} />
            </Box>
          ) : (
            <Text style={styles.balanceValue} color="textPrimary">
              {!showBalance
                ? '****'
                : // No figure at all beats a fabricated one: with nothing fetched
                  // and nothing cached, "$0.00" would read as an empty wallet.
                  portfolio
                  ? formatUsdValue(totalUsd).text
                  : '—'}
            </Text>
          )}

          <Box flexDirection="row" alignItems="center" gap="xs" mt="xs">
            <Text variant="p8" lineHeight={20} letterSpacing={0} color="textSubheading">
              {showBalance
                ? `${spendableXlm.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 7,
                  })} XLM`
                : '****'}
            </Text>
            <Text
              variant="p8"
              lineHeight={20}
              letterSpacing={0}
              style={{ color: dayChangeTint?.text ?? 'rgba(162,162,162,0.55)' }}
            >
              {showBalance ? `${dayChange ?? 0.0}%` : '****'}
            </Text>
          </Box>

          {/* Freshness, not a spinner. A background refresh has to be visible
              without blocking, and a persisted snapshot must never pass for a
              live figure. */}
          {balanceStatus && (
            <Text variant="p8" color="textSubheading" mt="xs">
              {balanceStatus}
            </Text>
          )}
          {usedFallback && showBalance && (
            <Text variant="p8" color="textSubheading" mt="xs">
              Showing USD — rate unavailable
            </Text>
          )}
        </Box>

        <Box flexDirection="row" justifyContent="center" style={styles.actions}>
          {ACTIONS.map((item) => (
            <Box key={item.label} alignItems="center" style={styles.action}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={item.label}
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
                  width={64}
                  height={64}
                  borderRadius={32}
                  backgroundColor="inputBox"
                  borderWidth={1}
                  borderColor="inputOutline"
                  justifyContent="center"
                  alignItems="center"
                >
                  <Image
                    source={item.icon}
                    contentFit="contain"
                    tintColor={theme.colors.iconPrimary}
                    style={styles.actionIcon}
                  />
                </Box>
              </TouchableOpacity>
              <Text
                variant="p7"
                fontFamily="SFproMedium"
                lineHeight={22}
                letterSpacing={0}
                color="textSubheading"
              >
                {item.label}
              </Text>
            </Box>
          ))}
        </Box>

        {(portfolio ?? []).length > 0 && (
          <Box paddingHorizontal="l" style={styles.section}>
            <SectionHeader title="My Assets" />
            <Box gap="s">
              {(portfolio ?? []).map((token) => {
                const usd = parseFloat(token.amount) * (livePrices[token.code]?.price || 0);
                return (
                  <TokenRow
                    key={token.code + (token.issuer ?? '')}
                    token={{ ...token, usdValue: isNaN(usd) ? 0 : usd }}
                    fiatLabel={
                      formatToken(token.amount, livePrices[token.code]?.price, { approx: false })
                        .text
                    }
                    showBalance={showBalance}
                  />
                );
              })}
            </Box>
          </Box>
        )}

        <Box style={styles.banners}>
          <FlatList
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            data={banners}
            onScroll={(e) => {
              const x = e.nativeEvent.contentOffset.x;
              setBannerIndex(Math.round(x / screenWidth));
            }}
            scrollEventThrottle={16}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => (
              <Box width={screenWidth} alignItems="center" justifyContent="center">
                <Box width={screenWidth - 48} height={100} overflow="hidden" borderRadius={20}>
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

        {migrationState?.state === 'not_started' && (
          <Box paddingHorizontal="l" mb="m">
            <TouchableOpacity activeOpacity={0.85} onPress={() => router.push('/(migration)')}>
              <Box
                borderRadius={16}
                padding="m"
                flexDirection="row"
                alignItems="center"
                gap="m"
                backgroundColor="warningSurface"
                borderColor="warningBorder"
                style={styles.migration}
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
                  <Text variant="p7" fontFamily="SFproMedium" style={{ color: theme.colors.warningTitle }}>
                    Assets on classic account
                  </Text>
                  <Text variant="p8" style={{ color: theme.colors.warningBody }} mt="xs">
                    Tap to migrate them to your smart account
                  </Text>
                </Box>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.warningBody} />
              </Box>
            </TouchableOpacity>
          </Box>
        )}

        <Box paddingHorizontal="l" style={styles.section}>
          <SectionHeader
            title="Recent Activity"
            action="View all"
            onPress={() => router.push('/(tabs)/history')}
          />

          {/* The history scan is much slower than the balance fetch, so it gets
              its own state here rather than holding the screen. "No Activity
              Yet" is only the truth once a fetch has actually completed —
              while one is still running it would be a guess. */}
          {txLoading ? (
            <Box>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} width="100%" height={64} borderRadius={16} mb="s" />
              ))}
            </Box>
          ) : recentTx.length === 0 ? (
            <Box alignItems="center" gap="l" style={styles.empty}>
              <Image source={ICONS.emptyMascot} contentFit="contain" style={styles.emptyMascot} />
              <Box alignItems="center" gap="xs">
                <Text variant="p6" fontFamily="SFproMedium" lineHeight={20} letterSpacing={0.16} color="textPrimary">
                  No Activity Yet
                </Text>
                <Text variant="p7" lineHeight={20} letterSpacing={0.14} color="textSubheading">
                  Fund your wallet & get started!
                </Text>
              </Box>
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
        // Bypasses depositMintPlan's reuse guard on purpose: the current memo's
        // deposit failed, so the user needs a new one to send against.
        onRetry={() => {
          if (smartAccountAddress && !createDepositIntent.isPending) {
            createDepositIntent.mutate({ smartAccountAddress });
          }
        }}
      />
    </Box>
  );
};

const styles = StyleSheet.create({
  fill: {
    width: '100%',
    height: '100%',
  },
  headerAccount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  avatar: {
    width: 32,
    height: 32,
  },
  headerText: {
    gap: 2,
  },
  greeting: {
    color: '#A09F9F',
    opacity: 0.7,
  },
  copy: {
    marginTop: 16,
  },
  copyIcon: {
    width: 13.3,
    height: 12.8,
  },
  bell: {
    width: 20,
    height: 20,
  },
  unreadDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  balance: {
    marginTop: 40,
  },
  balanceToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 14,
  },
  eye: {
    width: 13.6,
    height: 13.6,
  },
  balanceValue: {
    fontFamily: 'SFproRoundedBold',
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -2,
  },
  actions: {
    gap: 14,
    marginTop: 24,
  },
  action: {
    width: 66,
    gap: 9,
  },
  actionIcon: {
    width: 32,
    height: 32,
  },
  banners: {
    marginTop: 28,
  },
  dots: {
    gap: 3,
    marginTop: 11,
  },
  migration: {
    marginTop: 8,
    borderWidth: 1,
  },
  section: {
    marginTop: 34,
  },
  sectionAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chevron: {
    width: 10,
    height: 20,
  },
  empty: {
    marginTop: 32,
  },
  emptyMascot: {
    width: 172.5,
    height: 164.5,
  },
  tokenRow: {
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
});

export default Home;
