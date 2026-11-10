import { frame, solo, type Illustration } from './slides';

const COIN_SIZE: [number, number] = [84.488, 41.888];
const WALLET_SIZE: [number, number] = [217.854, 107.193];
const WALLET_FRAME = frame(86.92, 257.55, 221.539, 114.896);
const WALLET_TILT = [{ rotate: '-2.04deg' }];

export const CREATE_WALLET_ART: Illustration = {
  artboard: frame(0, 0, 390, 400),
  durationMs: 0,
  layers: [
    solo(require('@/src/assets/images/onboarding/create-wallet/wallet-back.svg'), WALLET_FRAME, {
      size: WALLET_SIZE,
      transform: WALLET_TILT,
      imageInset: [0.19, 0, 0, 0],
    }),
    solo(
      require('@/src/assets/images/onboarding/create-wallet/coin-xlm.svg'),
      frame(166.67, 206.89, 119.488, 165.082),
      { size: [148.949, 73.846], transform: [{ rotate: '-70.42deg' }] },
    ),
    solo(
      require('@/src/assets/images/onboarding/create-wallet/logo-xlm.png'),
      frame(203.79, 256.04, 38.825, 55.777),
      {
        size: [38.54, 38.54],
        transform: [{ rotate: '-27deg' }, { scaleY: 0.83 }, { skewX: '-33.69deg' }],
      },
    ),
    solo(
      require('@/src/assets/images/onboarding/create-wallet/coin-purple.svg'),
      frame(153.42, 127.65, 93.626, 67.701),
      { size: COIN_SIZE, transform: [{ rotate: '160.49deg' }, { scaleY: -1 }] },
    ),
    solo(require('@/src/assets/images/onboarding/create-wallet/wallet-front.svg'), WALLET_FRAME, {
      size: WALLET_SIZE,
      transform: WALLET_TILT,
      imageInset: [8.04, 0, 0, 0],
    }),
    solo(
      require('@/src/assets/images/onboarding/create-wallet/coin-usdc.svg'),
      frame(112.2, 174.76, 66.009, 93.31),
      { size: COIN_SIZE, transform: [{ rotate: '-108.05deg' }, { scaleY: -1 }] },
    ),
    solo(
      require('@/src/assets/images/onboarding/create-wallet/logo-usdc.png'),
      frame(126.62, 199.04, 40.921, 41.719),
      {
        size: [31.923, 31.923],
        transform: [{ rotate: '21.8deg' }, { scaleY: 0.74 }, { skewX: '42.5deg' }],
      },
    ),
    solo(
      require('@/src/assets/images/onboarding/create-wallet/coin-usdt.svg'),
      frame(209.51, 155.47, 94.016, 79.267),
      { size: COIN_SIZE, transform: [{ rotate: '-30.83deg' }] },
    ),
    solo(
      require('@/src/assets/images/onboarding/create-wallet/logo-usdt.png'),
      frame(222.25, 176.3, 69.207, 32.249),
      {
        size: [38.217, 38.217],
        transform: [{ rotate: '27.65deg' }, { scaleY: 0.77 }, { skewX: '-40.03deg' }],
      },
    ),
    solo(
      require('@/src/assets/images/onboarding/create-wallet/wallet-logo.svg'),
      frame(143.845, 319.02, 45.031, 21.794),
      {
        size: [35.668, 19.023],
        transform: [{ rotate: '8.84deg' }, { scaleY: 0.77 }, { skewX: '39.81deg' }],
      },
    ),
    solo(
      require('@/src/assets/images/onboarding/create-wallet/sparkle.svg'),
      frame(283, 287, 19, 19),
    ),
    solo(
      require('@/src/assets/images/onboarding/create-wallet/sparkle.svg'),
      frame(126, 142, 19, 19),
    ),
  ],
};
