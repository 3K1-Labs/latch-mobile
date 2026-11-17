import AsyncStorage from '@react-native-async-storage/async-storage';

export const WALLET_COLORS = [
  '#59B101',
  '#FFBB2C',
  '#E9075A',
  '#1D1D1D',
  '#944BD9',
  '#FF8F20',
] as const;

export const DEFAULT_CARD_COLOR = '#1D1D1D';

export interface WalletAppearance {
  name: string;
  image: string | null;
  color: string | null;
}

const PENDING_KEY = 'latch_pending_wallet_appearance';
const APPEARANCES_KEY = 'latch_wallet_appearances';

const readAppearances = async (): Promise<Record<string, WalletAppearance>> => {
  const raw = await AsyncStorage.getItem(APPEARANCES_KEY);
  return raw ? (JSON.parse(raw) as Record<string, WalletAppearance>) : {};
};

export const savePendingAppearance = (appearance: WalletAppearance) =>
  AsyncStorage.setItem(PENDING_KEY, JSON.stringify(appearance));

export const loadPendingAppearance = async (): Promise<WalletAppearance | null> => {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as WalletAppearance) : null;
  } catch {
    return null;
  }
};

// A wallet that deployed must never be reported as failed over its card colour.
export const commitPendingAppearance = async (
  address: string,
  appearance: WalletAppearance,
): Promise<void> => {
  try {
    const appearances = await readAppearances();
    await AsyncStorage.setItem(
      APPEARANCES_KEY,
      JSON.stringify({ ...appearances, [address]: appearance }),
    );
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch {}
};

export const loadWalletAppearance = async (address: string): Promise<WalletAppearance | null> => {
  try {
    return (await readAppearances())[address] ?? null;
  } catch {
    return null;
  }
};

const mix = (hex: string, target: number, ratio: number) => {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${channels.map((c) => Math.round(c + (target - c) * ratio)).join(',')})`;
};

export const tintColor = (hex: string, ratio: number) => mix(hex, 255, ratio);
export const shadeColor = (hex: string, ratio: number) => mix(hex, 0, ratio);

/** True when dark text reads better than light text on `hex` (WCAG relative luminance). */
export const isLightColor = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
};
