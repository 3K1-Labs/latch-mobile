import { RoundBackButton, SetupButton } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import SwapCard from '@/src/components/swap/SwapCard';
import SwapRoutePickerSheet from '@/src/components/swap/SwapRoutePickerSheet';
import { SummaryCard, SummaryRow, SummaryValue } from '@/src/components/swap/SwapSummary';
import SwapTokenPickerSheet from '@/src/components/swap/SwapTokenPickerSheet';
import { swapTokenImage } from '@/src/components/swap/token-image';
import { STELLAR_NETWORK_PASSPHRASE } from '@/src/constants/config';
import { getWellKnownTokens } from '@/src/constants/known-tokens';
import { usePortfolio } from '@/src/hooks/use-portfolio';
import { usePrices } from '@/src/hooks/use-prices';
import { useDisplayFiat } from '@/src/hooks/use-display-fiat';
import { ImplausibleQuoteError, useSwapQuote } from '@/src/hooks/use-swap-quote';
import { useTokenIcon, useTokenList } from '@/src/hooks/use-token-list';
import { useTrackedTokens } from '@/src/hooks/use-tracked-tokens';
import { useTabBarScroll } from '@/src/context/tab-bar-scroll';
import { getActiveSwapProvider, listSwapProviders } from '@/src/services/swap/registry';
import type { SwapToken } from '@/src/services/swap/types';
import { useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { shortenAddress } from '@/src/utils';
import { useTheme } from '@shopify/restyle';
import { Asset } from '@stellar/stellar-sdk';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFormik } from 'formik';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import Toast from 'react-native-toast-message';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Yup from 'yup';

const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%
const QUICK_USD_AMOUNTS = [100, 500];

const ICONS = {
  flip: require('@/src/assets/images/swap/flip.svg'),
  chevronDown: require('@/src/assets/images/swap/chevron-down.svg'),
  chevronRight: require('@/src/assets/images/home/chevron.svg'),
  rate: require('@/src/assets/images/swap/flip-small.svg'),
};

// Round down so a quick-fill amount never exceeds what was asked for, and keep
// it within Stellar's 7-decimal precision without exponent notation.
const toAmountString = (value: number) =>
  (Math.floor(value * 1e7) / 1e7).toFixed(7).replace(/\.?0+$/, '');

const Swap = () => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const tabBarScroll = useTabBarScroll();
  const queryClient = useQueryClient();
  const { smartAccountAddress, accounts, activeAccountIndex } = useWalletStore();
  const activeAccount = accounts[activeAccountIndex];
  const { tokens: trackedTokens } = useTrackedTokens();
  const { data: prices, refetch: refetchPrices } = usePrices();
  const { formatToken, formatUsdValue } = useDisplayFiat();
  const { data: portfolio, refetch: refetchPortfolio } = usePortfolio(
    smartAccountAddress,
    activeAccount?.gAddress,
    trackedTokens,
  );
  // Mounted for its refetch only — useTokenIcon already reads this same
  // ['token-list'] query, so the extra observer shares the cached result.
  const { refetch: refetchTokenList } = useTokenList();

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    // RefreshControl can fire again mid-flight (release, pull again); a second
    // pass would reset `refreshing` when the FIRST one finishes and leave the
    // spinner detached from the requests still running.
    if (refreshing) return;
    setRefreshing(true);
    try {
      // The swap quote is deliberately not refetched here. Re-pricing the leg
      // the user is reading, under their finger, is a different action from
      // refreshing what they hold — useFocusEffect already handles staleness on
      // re-entry.
      const results = await Promise.all([
        refetchPrices(),
        refetchPortfolio(),
        refetchTokenList(),
      ]);
      // refetch() resolves with the failure rather than rejecting, so a failed
      // pull is silent unless the results are inspected. React Query keeps the
      // last successful data on the query, so the screen still shows it.
      if (results.some((r) => r.isError)) {
        Toast.show({ type: 'error', text1: "Couldn't refresh balances" });
      }
    } finally {
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['prices'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      // Cached quotes are priced at the moment they were fetched. Returning to
      // this screen must never re-render one as if it were current.
      queryClient.invalidateQueries({ queryKey: ['swap-quote'] });
    }, [queryClient]),
  );

  // Tokens the account actually HOLDS (non-zero balance). Used to seed the
  // From leg and to supply real balances; both pickers list the full
  // swappable universe so a quote can be fetched without holding the token.
  const tokens = useMemo(() => portfolio ?? [], [portfolio]);

  // fromToken/toToken hold a *snapshot* of the token object, so any balance read
  // off them is frozen at the moment of selection — and the initial selection
  // happens before usePortfolio resolves, when every candidate still carries the
  // `amount: '0'` placeholder from swappableTokens. Balances are therefore looked
  // up live by SAC id instead of read from the selection.
  const heldBySac = useMemo(
    () => new Map(tokens.map((t) => [t.sacContractId, t])),
    [tokens],
  );
  const balanceOf = useCallback(
    (token: SwapToken | null) =>
      token ? (heldBySac.get(token.sacContractId)?.amount ?? '0') : '0',
    [heldBySac],
  );

  // Full swappable universe for the "To" leg: well-known + tracked tokens (which
  // you may not hold yet), with held balances overlaid. usePortfolio drops
  // zero-balance tokens, so it alone can't populate the destination picker.
  const swappableTokens = useMemo<SwapToken[]>(() => {
    const map = new Map<string, SwapToken>();
    const addConfig = (code: string, issuer: string | undefined, sacContractId: string) => {
      if (!map.has(sacContractId)) {
        map.set(sacContractId, { code, issuer, sacContractId, amount: '0', usdValue: 0 });
      }
    };
    addConfig('XLM', undefined, Asset.native().contractId(STELLAR_NETWORK_PASSPHRASE));
    // for (const t of [...getWellKnownTokens(), ...trackedTokens]) {
    for (const t of getWellKnownTokens()) {
      try {
        const sac =
          t.sacContractId ?? new Asset(t.code, t.issuer!).contractId(STELLAR_NETWORK_PASSPHRASE);
        addConfig(t.code, t.issuer, sac);
      } catch {
        // skip tokens we can't resolve a SAC id for
      }
    }
    // Held balances override the zero-balance placeholders.
    for (const held of tokens) map.set(held.sacContractId, held);
    return Array.from(map.values());
  }, [
    // trackedTokens,
    tokens,
  ]);

  // undefined → use the network's default (first) provider. A stale id from a
  // previous network is harmless: getActiveSwapProvider falls back to the
  // default when the id isn't registered for the active network.
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>(undefined);
  const provider = getActiveSwapProvider(selectedProviderId);
  const availableProviders = listSwapProviders();

  const [fromToken, setFromToken] = useState<SwapToken | null>(null);
  const [toToken, setToToken] = useState<SwapToken | null>(null);
  // True while From holds a pre-portfolio placeholder that may still be replaced
  // by a held token. Any deliberate act by the user clears it — a late re-seed
  // must never overwrite a choice they made themselves.
  const fromSeedProvisional = useRef(false);
  const [pickerSide, setPickerSide] = useState<'from' | 'to' | null>(null);
  const [showRoutePicker, setShowRoutePicker] = useState(false);
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [showSlippageOptions, setShowSlippageOptions] = useState(false);
  const [customSlippage, setCustomSlippage] = useState('');
  const [showUsdRate, setShowUsdRate] = useState(false);
  const [amountFocused, setAmountFocused] = useState(false);

  const applyCustomSlippage = (pct: string) => {
    setCustomSlippage(pct);
    const bps = Math.round(parseFloat(pct) * 100);
    if (Number.isFinite(bps) && bps > 0 && bps <= 5000) setSlippageBps(bps);
  };

  // Remote token icons from the Soroswap token list (same source as the picker)
  // so a selected token keeps its real logo instead of the local-asset fallback.
  const fromIconUrl = useTokenIcon(fromToken?.code, fromToken?.issuer);
  const toIconUrl = useTokenIcon(toToken?.code, toToken?.issuer);

  // Seed From from a held token when there is one, otherwise fall back to the
  // swappable universe. Quoting is a read-only price lookup, so an empty
  // portfolio must not leave From null — that would disable useSwapQuote and
  // hide the whole details block (route/rate/slippage) behind `quote &&`.
  // Approve stays correctly blocked by `insufficient` below.
  useEffect(() => {
    const holdingsLoaded = tokens.length > 0;
    const fromCandidates = holdingsLoaded ? tokens : swappableTokens;

    if (!fromToken && fromCandidates.length > 0) {
      // A seed taken before the portfolio resolves is a placeholder rather than
      // a choice — it comes from swappableTokens, where every entry reads
      // `amount: '0'`.
      fromSeedProvisional.current = !holdingsLoaded;
      setFromToken(fromCandidates[0]);
      return;
    }

    // Holdings landed after a provisional seed. Re-apply the intent above (From
    // defaults to a token the account holds), which the cold-start ordering
    // otherwise defeats: on first visit the effect always runs against an empty
    // portfolio, so From would keep whichever token happened to sort first in
    // the swappable universe.
    if (fromSeedProvisional.current && holdingsLoaded) {
      fromSeedProvisional.current = false;
      const held = tokens[0];
      setFromToken(held);
      if (toToken?.sacContractId === held.sacContractId) {
        setToToken(swappableTokens.find((t) => t.sacContractId !== held.sacContractId) ?? null);
      }
      return;
    }

    if (!toToken && swappableTokens.length > 0) {
      const fromSac = fromToken?.sacContractId ?? fromCandidates[0]?.sacContractId;
      setToToken(swappableTokens.find((t) => t.sacContractId !== fromSac) ?? null);
    }
  }, [tokens, swappableTokens, fromToken, toToken]);

  const rotation = useSharedValue(-90);
  const animatedIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const handleSwap = () => {
    fromSeedProvisional.current = false;
    rotation.value = withTiming(rotation.value + 180, { duration: 300 });
    setFromToken(toToken);
    setToToken(fromToken);
  };

  const formik = useFormik({
    initialValues: { amount: '' },
    validationSchema: Yup.object({
      amount: Yup.number().positive().required(),
    }),
    onSubmit: () => {},
  });

  const handleAmountChange = (text: string) => {
    // Strip commas, allow only digits and a single decimal point
    const stripped = text.replace(/,/g, '').replace(/[^0-9.]/g, '');
    const parts = stripped.split('.');
    const sanitized = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : stripped;
    formik.setFieldValue('amount', sanitized);
  };

  // Debounce the amount so we don't hit the aggregator on every keystroke.
  const [debouncedAmount, setDebouncedAmount] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebouncedAmount(formik.values.amount), 300);
    return () => clearTimeout(id);
  }, [formik.values.amount]);

  // Tab screens stay mounted, so leaving the tab clears nothing on its own —
  // the typed amount and its quote would still be on screen, with Approve
  // still armed, when the user comes back minutes later. Clear on blur.
  // Read through a ref: Formik hands back a new object every render, so
  // depending on it directly would re-run this effect (and its cleanup) on
  // every keystroke and wipe the field as it is typed.
  const formikRef = useRef(formik);
  formikRef.current = formik;
  // Pushing the confirm screen also blurs this one, but that is still the same
  // swap in progress — backing out of confirm should return to what was typed.
  const goingToConfirm = useRef(false);
  useFocusEffect(
    useCallback(() => {
      goingToConfirm.current = false;
      return () => {
        if (goingToConfirm.current) return;
        formikRef.current.resetForm();
        setDebouncedAmount('');
      };
    }, []),
  );

  const {
    data: quote,
    isFetching: quoteFetching,
    error: quoteError,
  } = useSwapQuote({
    fromSacId: fromToken?.sacContractId,
    toSacId: toToken?.sacContractId,
    amountIn: debouncedAmount,
    slippageBps,
    providerId: provider.id,
    fromCode: fromToken?.code,
    toCode: toToken?.code,
  });
  // A debounce gap or an in-flight refetch means "waiting", not "no route".
  const quotePending = quoteFetching || debouncedAmount !== formik.values.amount;
  const badPrice = quoteError instanceof ImplausibleQuoteError && !quotePending;
  const noRoute = !!quoteError && !quotePending && !badPrice;

  const fromBalance = parseFloat(balanceOf(fromToken));
  const amountNum = parseFloat(formik.values.amount || '0');
  const insufficient = amountNum > fromBalance;
  const canApprove =
    !!fromToken && !!toToken && amountNum > 0 && !insufficient && !!quote && !quotePending;

  const handleApprove = () => {
    if (!canApprove || !fromToken || !toToken) return;
    goingToConfirm.current = true;
    router.push({
      pathname: '/swap/confirm',
      params: {
        fromSacId: fromToken.sacContractId,
        fromCode: fromToken.code,
        fromIssuer: fromToken.issuer ?? '',
        toSacId: toToken.sacContractId,
        toCode: toToken.code,
        toIssuer: toToken.issuer ?? '',
        amountIn: formik.values.amount,
        slippageBps: String(slippageBps),
        providerId: provider.id,
      },
    });
  };

  const handleSelectToken = (token: SwapToken) => {
    fromSeedProvisional.current = false;
    if (pickerSide === 'from') {
      if (token.sacContractId === toToken?.sacContractId) setToToken(fromToken);
      setFromToken(token);
    } else if (pickerSide === 'to') {
      if (token.sacContractId === fromToken?.sacContractId) setFromToken(toToken);
      setToToken(token);
    }
    setPickerSide(null);
  };

  const fromValue = formatToken(formik.values.amount, prices?.[fromToken?.code ?? '']?.price).text;
  // A cleared amount must not keep showing the last quote's output.
  const quotedOut = amountNum > 0 ? quote?.amountOut : undefined;
  const toAmount = quotedOut ?? '';
  const toValue = formatToken(quotedOut ?? '0', prices?.[toToken?.code ?? '']?.price).text;

  const fromUsdPrice = parseFloat(prices?.[fromToken?.code ?? '']?.price ?? '');
  // An unpriced token falls back to the token-denominated rate rather than
  // claiming it is worth $0.00.
  const usdRateLabel =
    fromToken && fromUsdPrice > 0
      ? `1 ${fromToken.code} ≈ ${formatUsdValue(fromUsdPrice, { approx: true }).text.replace(/^≈/, '')}`
      : null;
  const rateLabel =
    quote && fromToken && toToken
      ? ((showUsdRate ? usdRateLabel : null) ??
        `1 ${fromToken.code} ≈ ${quote.rate.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${toToken.code}`)
      : '—';

  // Quick-fill chips. Dollar chips need a live price for the From token; with
  // none they stay disabled rather than guessing a conversion.
  const fillUsd = (usd: number) => {
    if (!(fromUsdPrice > 0)) return;
    handleAmountChange(toAmountString(usd / fromUsdPrice));
  };
  const fillMax = () => {
    const bal = parseFloat(balanceOf(fromToken));
    if (bal > 0) handleAmountChange(toAmountString(bal));
  };
  const showSummary = !amountFocused && !!fromToken && !!toToken && amountNum > 0;

  const buttonLabel = !amountNum
    ? 'Enter Amount'
    : insufficient
      ? 'Insufficient Balance'
      : quotePending
        ? 'Fetching Quote…'
        : badPrice
          ? 'Price unavailable — try again'
          : noRoute
            ? 'No route for this pair'
            : 'Confirm Swap';

  return (
    <Box flex={1} backgroundColor="surfaceBase" style={{ paddingTop: insets.top }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <Box flexDirection="row" alignItems="center" justifyContent="center" style={styles.header}>
        <RoundBackButton onPress={() => router.back()} style={styles.backButton} />
        <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
          Swap Tokens
        </Text>
      </Box>

      <ScrollView
        {...tabBarScroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // `bounces={false}` was removed rather than tightened: iOS drives
        // RefreshControl off the overscroll bounce, and any narrowing of it
        // (alwaysBounceVertical) makes the pull unreachable whenever the form is
        // shorter than the viewport.
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary700}
          />
        }
        style={styles.fill}
      >
        <Box style={styles.cards}>
          <SwapCard
            label="You Pay"
            tokenCode={fromToken?.code ?? '—'}
            tokenIcon={fromIconUrl ? { uri: fromIconUrl } : swapTokenImage(fromToken?.code)}
            amount={formik.values.amount}
            fiatValue={fromValue}
            balance={`${balanceOf(fromToken)} ${fromToken?.code ?? ''}`}
            editable
            onAmountChange={handleAmountChange}
            onFocusChange={setAmountFocused}
            onTokenSelect={() => setPickerSide('from')}
          />

          <SwapCard
            label="You Receive"
            tokenCode={toToken?.code ?? '—'}
            tokenIcon={toIconUrl ? { uri: toIconUrl } : swapTokenImage(toToken?.code)}
            amount={toAmount}
            fiatValue={toValue}
            balance={`${balanceOf(toToken)} ${toToken?.code ?? ''}`}
            onTokenSelect={() => setPickerSide('to')}
          />

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Switch tokens"
            onPress={handleSwap}
            activeOpacity={0.8}
            style={styles.flip}
          >
            <Animated.View style={animatedIconStyle}>
              <Image source={ICONS.flip} tintColor="#121212" style={styles.flipIcon} />
            </Animated.View>
          </TouchableOpacity>
        </Box>

        <Box height={1} backgroundColor="inputOutline" style={styles.divider} />

        {showSummary ? (
          <SummaryCard>
              <SummaryRow label="Provider">
                {availableProviders.length < 2 ? (
                  <Box flexDirection="row" alignItems="center" gap="s">
                    <Image source={provider.icon} style={styles.providerIcon} />
                    <SummaryValue>{provider.name}</SummaryValue>
                  </Box>
                ) : (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => setShowRoutePicker(true)}
                    style={styles.rowValue}
                  >
                    <Image source={provider.icon} style={styles.providerIcon} />
                    <SummaryValue>{provider.name}</SummaryValue>
                    <Image source={ICONS.chevronRight} contentFit="contain" style={styles.chevron} />
                  </TouchableOpacity>
                )}
              </SummaryRow>

              {quote && toToken && (
                <>
                  <SummaryRow label="Rate">
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setShowUsdRate((v) => !v)}
                      style={styles.rowValue}
                    >
                      <SummaryValue>{rateLabel}</SummaryValue>
                      <Box style={styles.rateBadge}>
                        <Image source={ICONS.rate} style={styles.rateIcon} />
                      </Box>
                    </TouchableOpacity>
                  </SummaryRow>

                  <SummaryRow label="Slippage">
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setShowSlippageOptions((v) => !v)}
                      style={styles.rowValue}
                    >
                      <SummaryValue>
                        {(slippageBps / 100).toFixed(slippageBps % 100 === 0 ? 1 : 2)}%
                      </SummaryValue>
                      <Image
                        source={ICONS.chevronDown}
                        contentFit="contain"
                        style={[styles.chevron, showSlippageOptions && styles.chevronUp]}
                      />
                    </TouchableOpacity>
                  </SummaryRow>

                  {showSlippageOptions && (
                    <Box flexDirection="row" alignItems="center" flexWrap="wrap" gap="s">
                      {[10, 50, 100].map((bps) => {
                        const selected = slippageBps === bps && !customSlippage;
                        return (
                          <TouchableOpacity
                            key={bps}
                            activeOpacity={0.7}
                            onPress={() => {
                              setCustomSlippage('');
                              setSlippageBps(bps);
                            }}
                          >
                            <Box
                              borderRadius={40}
                              borderWidth={1}
                              borderColor={selected ? 'accentGreen' : 'inputOutline'}
                              backgroundColor="inputBox"
                              style={styles.slippageChip}
                            >
                              <Text fontSize={14} lineHeight={20} color="textPrimary">
                                {(bps / 100).toFixed(1)}%
                              </Text>
                            </Box>
                          </TouchableOpacity>
                        );
                      })}
                      <Box
                        flexDirection="row"
                        alignItems="center"
                        borderRadius={40}
                        borderWidth={1}
                        borderColor={customSlippage ? 'accentGreen' : 'inputOutline'}
                        backgroundColor="inputBox"
                        style={styles.slippageChip}
                      >
                        <TextInput
                          style={[styles.slippageInput, { color: theme.colors.textPrimary }]}
                          value={customSlippage}
                          onChangeText={applyCustomSlippage}
                          placeholder="Custom"
                          placeholderTextColor={theme.colors.textPlaceholder}
                          keyboardType="decimal-pad"
                        />
                        <Text fontSize={14} lineHeight={20} color="textSubheading">
                          %
                        </Text>
                      </Box>
                    </Box>
                  )}

                  <SummaryRow label="Min. Received">
                    <SummaryValue>
                      {quote.minReceived} {toToken.code}
                    </SummaryValue>
                  </SummaryRow>

                  <SummaryRow label="Price Impact">
                    <SummaryValue>{quote.priceImpactPct.toFixed(2)}%</SummaryValue>
                  </SummaryRow>

                  <SummaryRow label="Network Fee">
                    <SummaryValue>Shown on confirm</SummaryValue>
                  </SummaryRow>
                </>
              )}

              {smartAccountAddress && (
                <SummaryRow label="Receive Address">
                  <SummaryValue>{shortenAddress(smartAccountAddress)}</SummaryValue>
                </SummaryRow>
              )}
          </SummaryCard>
        ) : (
          <Box flexDirection="row" gap="sm">
            {QUICK_USD_AMOUNTS.map((usd) => (
              <QuickChip
                key={usd}
                label={`$${usd}`}
                disabled={!(fromUsdPrice > 0)}
                onPress={() => fillUsd(usd)}
              />
            ))}
            <QuickChip
              label="Max"
              disabled={!(parseFloat(balanceOf(fromToken)) > 0)}
              onPress={fillMax}
            />
          </Box>
        )}

        <Box style={styles.cta}>
          <SetupButton
            label={buttonLabel}
            disabled={!canApprove}
            onPress={handleApprove}
          />
        </Box>
      </ScrollView>

      <SwapTokenPickerSheet
        visible={pickerSide !== null}
        title="Select Token"
        tokens={swappableTokens}
        excludeSacId={pickerSide === 'from' ? toToken?.sacContractId : fromToken?.sacContractId}
        onClose={() => setPickerSide(null)}
        onSelect={handleSelectToken}
      />

      <SwapRoutePickerSheet
        visible={showRoutePicker}
        providers={availableProviders}
        selectedId={provider.id}
        onClose={() => setShowRoutePicker(false)}
        onSelect={(id) => {
          // Invalidate the cache for the previous provider so keepPreviousData
          // doesn't show stale data from the old provider while the new quote
          // is in flight.
          queryClient.invalidateQueries({ queryKey: ['swap-quote'] });
          setSelectedProviderId(id);
          setShowRoutePicker(false);
        }}
      />
    </Box>
  );
};

const QuickChip = ({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) => (
  <TouchableOpacity
    activeOpacity={0.7}
    disabled={disabled}
    onPress={onPress}
    style={[styles.quickChip, disabled && styles.disabled]}
  >
    <Box
      flex={1}
      alignItems="center"
      justifyContent="center"
      backgroundColor="inputBox"
      borderColor="inputOutline"
      borderWidth={1}
      borderRadius={40}
      style={styles.quickChipInner}
    >
      <Text fontSize={16} lineHeight={24} letterSpacing={0.32} color="textPrimary">
        {label}
      </Text>
    </Box>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  header: {
    height: 64,
    marginTop: 4,
  },
  backButton: {
    position: 'absolute',
    left: 24,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 30,
  },
  cards: {
    gap: 11,
  },
  flip: {
    position: 'absolute',
    alignSelf: 'center',
    // Straddles the gap between the two 140pt-tall cards.
    top: 125,
    width: 39,
    height: 39,
    borderRadius: 20,
    backgroundColor: '#FFC508',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipIcon: {
    width: 22,
    height: 22,
  },
  divider: {
    marginTop: 32,
    marginBottom: 16,
  },
  rowValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  providerIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
  },
  chevron: {
    width: 18,
    height: 18,
  },
  chevronUp: {
    transform: [{ rotate: '180deg' }],
  },
  rateBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#F8FCEB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rateIcon: {
    width: 12,
    height: 12,
    transform: [{ rotate: '-90deg' }],
  },
  slippageChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  slippageInput: {
    minWidth: 52,
    padding: 0,
    fontSize: 14,
    fontFamily: 'SFproRegular',
    textAlign: 'right',
  },
  quickChip: {
    flex: 1,
  },
  quickChipInner: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  disabled: {
    opacity: 0.4,
  },
  cta: {
    marginTop: 40,
  },
});

export default Swap;
