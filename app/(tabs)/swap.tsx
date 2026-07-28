import { Swap as SwapIcon } from '@/src/components/CustomTabBar';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import SwapCard from '@/src/components/swap/SwapCard';
import SwapRoutePickerSheet from '@/src/components/swap/SwapRoutePickerSheet';
import SwapTokenPickerSheet from '@/src/components/swap/SwapTokenPickerSheet';
import { swapTokenImage } from '@/src/components/swap/token-image';
import { STELLAR_NETWORK_PASSPHRASE } from '@/src/constants/config';
import { getWellKnownTokens } from '@/src/constants/known-tokens';
import { usePortfolio } from '@/src/hooks/use-portfolio';
import { usePrices } from '@/src/hooks/use-prices';
import { ImplausibleQuoteError, useSwapQuote } from '@/src/hooks/use-swap-quote';
import { useTokenIcon } from '@/src/hooks/use-token-list';
import { useTrackedTokens } from '@/src/hooks/use-tracked-tokens';
import { useTabBarScroll } from '@/src/context/tab-bar-scroll';
import { getActiveSwapProvider, listSwapProviders } from '@/src/services/swap/registry';
import type { SwapToken } from '@/src/services/swap/types';
import { useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { Asset } from '@stellar/stellar-sdk';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFormik } from 'formik';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Yup from 'yup';

const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%

const formatUsd = (amountStr: string, price?: string) => {
  const amount = parseFloat(amountStr || '0');
  const p = parseFloat(price ?? '0');
  if (!amount || !p) return '≈$0.00';
  return `≈$${(amount * p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const Swap = () => {
  const theme = useTheme<Theme>();
  const isDark = theme.colors.mainBackground === '#000000';
  const insets = useSafeAreaInsets();
  const tabBarScroll = useTabBarScroll();
  const queryClient = useQueryClient();
  const { smartAccountAddress, accounts, activeAccountIndex } = useWalletStore();
  const activeAccount = accounts[activeAccountIndex];
  const { tokens: trackedTokens } = useTrackedTokens();
  const { data: prices } = usePrices();
  const { data: portfolio } = usePortfolio(
    smartAccountAddress,
    activeAccount?.gAddress,
    trackedTokens,
  );
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
  const [pickerSide, setPickerSide] = useState<'from' | 'to' | null>(null);
  const [showRoutePicker, setShowRoutePicker] = useState(false);
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [showSlippageOptions, setShowSlippageOptions] = useState(false);
  const [customSlippage, setCustomSlippage] = useState('');
  const [showUsdRate, setShowUsdRate] = useState(false);

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
    const fromCandidates = tokens.length > 0 ? tokens : swappableTokens;
    if (!fromToken && fromCandidates.length > 0) setFromToken(fromCandidates[0]);
    if (!toToken && swappableTokens.length > 0) {
      const fromSac = fromToken?.sacContractId ?? fromCandidates[0]?.sacContractId;
      setToToken(swappableTokens.find((t) => t.sacContractId !== fromSac) ?? null);
    }
  }, [tokens, swappableTokens, fromToken, toToken]);

  const rotation = useSharedValue(90);
  const animatedIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const animatedIconStyle2 = useAnimatedStyle(() => ({
    transform: [{ rotate: '90deg' }],
  }));

  const handleSwap = () => {
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

  const fromBalance = parseFloat(fromToken?.amount ?? '0');
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
    if (pickerSide === 'from') {
      if (token.sacContractId === toToken?.sacContractId) setToToken(fromToken);
      setFromToken(token);
    } else if (pickerSide === 'to') {
      if (token.sacContractId === fromToken?.sacContractId) setFromToken(toToken);
      setToToken(token);
    }
    setPickerSide(null);
  };

  const fromValue = formatUsd(formik.values.amount, prices?.[fromToken?.code ?? '']?.price);
  const toAmount = quote?.amountOut ?? '0.00';
  const toValue = formatUsd(quote?.amountOut ?? '0', prices?.[toToken?.code ?? '']?.price);

  const fromUsdPrice = parseFloat(prices?.[fromToken?.code ?? '']?.price ?? '0');
  const rateLabel =
    quote && fromToken && toToken
      ? showUsdRate
        ? `1 ${fromToken.code} ≈ $${fromUsdPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
        : `1 ${fromToken.code} ≈ ${quote.rate.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${toToken.code}`
      : '—';

  return (
    <Box flex={1} backgroundColor="onboardingbg" style={{ paddingTop: insets.top }}>
<StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Header */}
      <Box
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        paddingHorizontal="m"
        style={styles.header}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text variant="h10" color="textPrimary" fontFamily={'SFproSemibold'}>
          Swap
        </Text>
      </Box>

      <ScrollView
        {...tabBarScroll}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        bounces={false}
        style={{ flex: 1 }}
      >
        <Box paddingHorizontal="m" paddingTop="m">
          {/* From Section Header */}
          <Box
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            marginBottom="s"
          >
            <Text variant="p7" color="textSecondary">
              From
            </Text>
            {/* Non-functional placeholder toggle from the original mock — see
                the useExchangeBalance declaration above. */}
            {/* <Box flexDirection="row" alignItems="center">
              <Text variant="p7" color="textSecondary" style={styles.exchangeLabel}>
                Use Exchange Balance
              </Text>
              <Switch value={useExchangeBalance} onValueChange={setUseExchangeBalance} />
            </Box> */}
          </Box>

          {/* First Swap Card (From) */}
          <SwapCard
            tokenName={fromToken?.code ?? '—'}
            tokenSubtitle={fromToken?.code ? `${fromToken.code} on Stellar` : 'Select a token'}
            tokenIcon={fromIconUrl ? { uri: fromIconUrl } : swapTokenImage(fromToken?.code)}
            amount={formik.values.amount}
            onAmountChange={handleAmountChange}
            value={fromValue}
            walletName="My Wallet"
            walletBalance={`${fromToken?.amount ?? '0'} ${fromToken?.code ?? ''}`}
            walletValue={`${fromToken?.amount ?? '0'} ${fromToken?.code ?? ''}`}
            showAddFunds={insufficient}
            showWalletDropdown
            onTokenSelect={() => setPickerSide('from')}
          />

          {/* Swap button + From label for second section */}
          <Box flexDirection="row" alignItems="center" mt={'m'} mb={'xs'}>
            <Text variant="p7" color="textSecondary">
              To
            </Text>
            <Box
              flex={1}
              alignItems="center"
              position={'absolute'}
              left={'43%'}
              top={-25}
              style={{ zIndex: 99999, elevation: 9999 }}
            >
              <TouchableOpacity onPress={handleSwap} activeOpacity={0.8}>
                <Box
                  width={56}
                  height={56}
                  borderRadius={28}
                  backgroundColor="primary"
                  justifyContent="center"
                  alignItems="center"
                >
                  <Animated.View style={animatedIconStyle}>
                    <SwapIcon width={24} color="#000000" />
                  </Animated.View>
                </Box>
              </TouchableOpacity>
            </Box>
          </Box>

          {/* Second Swap Card (To) */}
          <SwapCard
            tokenName={toToken?.code ?? '—'}
            tokenSubtitle={toToken?.code ? `${toToken.code} on Stellar` : 'Select a token'}
            tokenIcon={toIconUrl ? { uri: toIconUrl } : swapTokenImage(toToken?.code)}
            amount={toAmount}
            value={toValue}
            walletName="My Wallet"
            walletBalance={`${toToken?.amount ?? '0'} ${toToken?.code ?? ''}`}
            walletValue={`${toToken?.amount ?? '0'} ${toToken?.code ?? ''}`}
            showAddFunds={false}
            showWalletDropdown
            onTokenSelect={() => setPickerSide('to')}
          />

          {/* Approve Swap Button */}
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.enterAmountButton}
            disabled={!canApprove}
            onPress={handleApprove}
          >
            <Box
              height={56}
              backgroundColor={canApprove ? 'primary' : 'bg900'}
              borderRadius={28}
              justifyContent="center"
              alignItems="center"
              flexDirection={'row'}
              gap={'sm'}
            >
              {quotePending && <ActivityIndicator color={theme.colors.textPrimary} />}
              <Text
                variant="h10"
                color={quotePending || insufficient || !amountNum ? 'white' : 'bgDark900'}
                style={{ fontWeight: '600' }}
              >
                {!amountNum
                  ? 'Enter Amount'
                  : insufficient
                    ? 'Insufficient Balance'
                    : quotePending
                      ? 'Fetching Quote…'
                      : badPrice
                        ? 'Price unavailable — try again'
                        : noRoute
                          ? 'No route for this pair'
                          : 'Approve Swap'}
              </Text>
            </Box>
          </TouchableOpacity>

          {/* Swap Details — shown only once a real quote has been fetched */}
          {quote && toToken && (
            <Box mt="xl">
              <Box flexDirection="row" justifyContent="space-between" alignItems="center" mb="m">
                <Text variant="p7" color="textSecondary">
                  Route
                </Text>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setShowRoutePicker(true)}
                  disabled={availableProviders.length < 2}
                  style={{ flexDirection: 'row', alignItems: 'center' }}
                >
                  <Image
                    source={provider.icon}
                    style={{ width: 24, height: 24, borderRadius: 6, marginRight: 8 }}
                  />
                  <Text variant="p7" color="textPrimary" style={{ marginRight: 8 }}>
                    {provider.name}
                  </Text>
                  {provider.id === availableProviders[0]?.id && (
                    <Box
                      backgroundColor="bg800"
                      paddingHorizontal="s"
                      paddingVertical="xs"
                      borderRadius={4}
                      style={{ backgroundColor: '#211B0C' }}
                    >
                      <Text variant="p8" color="primary" style={{ fontSize: 10 }}>
                        Recommend
                      </Text>
                    </Box>
                  )}
                  {availableProviders.length > 1 && (
                    <Ionicons
                      name="chevron-forward"
                      size={14}
                      color={theme.colors.textSecondary}
                      style={{ marginLeft: 8 }}
                    />
                  )}
                </TouchableOpacity>
              </Box>

              <Box flexDirection="row" justifyContent="space-between" alignItems="center" mb="m">
                <Text variant="p7" color="textSecondary">
                  Rate
                </Text>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setShowUsdRate((v) => !v)}
                  style={{ flexDirection: 'row', alignItems: 'center' }}
                >
                  <Text variant="p7" color="textPrimary" style={{ marginRight: 4 }}>
                    {rateLabel}
                  </Text>
                  <Animated.View style={animatedIconStyle2}>
                    <SwapIcon width={14} color={theme.colors.white} />
                  </Animated.View>
                </TouchableOpacity>
              </Box>

              <Box flexDirection="row" justifyContent="space-between" alignItems="center" mb="m">
                <Text variant="p7" color="textSecondary">
                  Slippage
                </Text>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setShowSlippageOptions((v) => !v)}
                  style={{ flexDirection: 'row', alignItems: 'center' }}
                >
                  <Text variant="p7" color="textPrimary" style={{ marginRight: 4 }}>
                    {(slippageBps / 100).toFixed(slippageBps % 100 === 0 ? 1 : 2)}%
                  </Text>
                  <Ionicons
                    name={showSlippageOptions ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={theme.colors.textSecondary}
                  />
                </TouchableOpacity>
              </Box>

              {showSlippageOptions && (
                <Box flexDirection="row" alignItems="center" mb="m" flexWrap="wrap">
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
                        style={{ marginRight: 8 }}
                      >
                        <Box
                          paddingHorizontal="m"
                          paddingVertical="s"
                          borderRadius={8}
                          backgroundColor={selected ? 'primary' : 'bg900'}
                        >
                          <Text variant="p8" color={selected ? 'bgDark900' : 'textPrimary'}>
                            {(bps / 100).toFixed(1)}%
                          </Text>
                        </Box>
                      </TouchableOpacity>
                    );
                  })}
                  <Box
                    flexDirection="row"
                    alignItems="center"
                    paddingHorizontal="m"
                    paddingVertical="s"
                    borderRadius={8}
                    backgroundColor="bg900"
                  >
                    <TextInput
                      style={styles.slippageInput}
                      value={customSlippage}
                      onChangeText={applyCustomSlippage}
                      placeholder="Custom"
                      placeholderTextColor={theme.colors.textSecondary}
                      keyboardType="decimal-pad"
                    />
                    <Text variant="p8" color="textSecondary">
                      %
                    </Text>
                  </Box>
                </Box>
              )}

              <Box flexDirection="row" justifyContent="space-between" alignItems="center" mb="m">
                <Text variant="p7" color="textSecondary">
                  Min. Received
                </Text>
                <Text variant="p7" color="textPrimary">
                  {quote.minReceived} {toToken.code}
                </Text>
              </Box>

              <Box flexDirection="row" justifyContent="space-between" alignItems="center" mb="m">
                <Text variant="p7" color="textSecondary">
                  Price Impact
                </Text>
                <Text variant="p7" color="textPrimary">
                  {quote.priceImpactPct.toFixed(2)}%
                </Text>
              </Box>

              <Box flexDirection="row" justifyContent="space-between" alignItems="center" mb="m">
                <Text variant="p7" color="textSecondary">
                  Network Fee
                </Text>
                <Text variant="p7" color="textPrimary">
                  Sponsored
                </Text>
              </Box>
            </Box>
          )}
        </Box>
      </ScrollView>

      <SwapTokenPickerSheet
        visible={pickerSide !== null}
        title={pickerSide === 'from' ? 'Swap From' : 'Swap To'}
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
          setSelectedProviderId(id);
          setShowRoutePicker(false);
        }}
      />
    </Box>
  );
};

const styles = StyleSheet.create({
  header: {
    height: 52,
  },
  backButton: {
    position: 'absolute',
    left: 16,
  },
  exchangeLabel: {
    marginRight: 8,
  },
  enterAmountButton: {
    marginTop: 40,
  },
  slippageInput: {
    minWidth: 44,
    padding: 0,
    fontSize: 12,
    fontFamily: 'SFproRegular',
    color: '#FFFFFF',
    textAlign: 'right',
  },
});

export default Swap;
