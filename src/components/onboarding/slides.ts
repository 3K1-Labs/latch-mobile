import type { ImageSourcePropType, ViewStyle } from 'react-native';
import { Easing } from 'react-native-reanimated';

export type Frame = { left: number; top: number; width: number; height: number };

export type Motion = {
  times: number[];
  easings?: ((t: number) => number)[];
  rotate?: number[];
  x?: number[];
  y?: number[];
  scaleX?: number[];
  scaleY?: number[];
};

export type ArtPart = {
  source: ImageSourcePropType;
  frame: Frame;
  size?: [number, number];
  transform?: ViewStyle['transform'];
  imageInset?: [number, number, number, number];
};

export type ArtLayer = { frame: Frame; parts: ArtPart[]; motion?: Motion };

export type Illustration = {
  artboard: Frame;
  clip?: boolean;
  durationMs: number;
  layers: ArtLayer[];
};

export type OnboardingSlide = {
  id: number;
  title: string;
  description: string;
  descriptionWidth: number;
  illustration: Illustration;
};

export const frame = (left: number, top: number, width: number, height: number): Frame => ({
  left,
  top,
  width,
  height,
});

const inset =
  (width: number, height: number) =>
  (top: number, right: number, bottom: number, left: number): Frame =>
    frame(
      (left / 100) * width,
      (top / 100) * height,
      (1 - (left + right) / 100) * width,
      (1 - (top + bottom) / 100) * height,
    );

export const solo = (
  source: ImageSourcePropType,
  box: Frame,
  options: Omit<ArtPart, 'source' | 'frame'> & { motion?: Motion } = {},
): ArtLayer => {
  const { motion, ...part } = options;
  return {
    frame: box,
    parts: [{ source, frame: frame(0, 0, box.width, box.height), ...part }],
    motion,
  };
};

const QUARTERS = [0, 0.25, 0.5, 0.75, 1];
const ICON_SIZE: [number, number] = [38.083, 38.083];
const MONEY_INSET: [number, number, number, number] = [-15.31, -14.55, -14.36, -15.12];

const WOBBLE: Motion = {
  times: [0, 0.13333, 0.3, 0.45833, 0.60417, 0.74167, 0.875, 1],
  rotate: [0, -0.087266, 0.069813, -0.047124, 0.027925, -0.012217, 0, 0],
  x: [0, -0.437538, 0.650001, -0.288256, 0.228173, -0.086424, 0, 0],
  y: [0, 4.795105, -3.797229, 2.584674, -1.524264, 0.668752, 0, 0],
};

const DROP_START = Easing.bezierFn(0.34, 0, 0.64, 1);
const DROP_FALL = Easing.bezierFn(0.55, 0, 1, 1);
const DROP_LAND = Easing.bezierFn(0, 0, 0.15, 1);
const DROP_SETTLE = Easing.bezierFn(0, 0, 0.58, 1);

const STAR_DROP: Motion = {
  times: [0, 0.05, 0.21667, 0.30833, 0.39167, 0.45417, 0.53333, 1],
  easings: [DROP_START, DROP_FALL, DROP_LAND, DROP_FALL, DROP_LAND, DROP_SETTLE, Easing.linear],
  scaleX: [1, 1.06, 1.42, 0.86, 1.2, 0.94, 1, 1],
  scaleY: [1, 0.94, 0.7, 1.16, 0.84, 1.07, 1, 1],
  x: [0, -8.335249, -58.346745, 19.448915, -27.784164, 8.335249, 0, 0],
  y: [-150, -154.349503, 18.25248, -85.734657, 9.734655, -28.258911, 0, 0],
};

const slide2Box = inset(360, 360);
const slide3Box = inset(390, 844);

const slide1: Illustration = {
  artboard: frame(23.98, 81, 339.032, 372),
  durationMs: 4000,
  layers: [
    solo(
      require('@/src/assets/images/onboarding/slide1/mascot.svg'),
      frame(0, 33.44, 339.032, 338.561),
      {
        motion: {
          times: QUARTERS,
          rotate: [0, 0.012217, 0, -0.008727, 0],
          y: [0, -10, 0, 6, 0],
        },
      },
    ),
    {
      frame: frame(66.88, 32.51, 40.878, 57.785),
      parts: [
        {
          source: require('@/src/assets/images/onboarding/slide1/coin-usdc.svg'),
          frame: frame(0, 0, 40.878, 57.785),
          size: [52.322, 25.94],
          transform: [{ rotate: '-108.05deg' }, { scaleY: -1 }],
        },
        {
          source: require('@/src/assets/images/onboarding/slide1/logo-usdc.png'),
          frame: frame(8.93, 15.04, 25.341, 25.835),
          size: [19.769, 19.769],
          transform: [{ rotate: '21.8deg' }, { scaleY: 0.74 }, { skewX: '42.5deg' }],
        },
      ],
      motion: {
        times: QUARTERS,
        rotate: [0.061087, 0, -0.061087, 0, 0.061087],
        x: [-2, 0, 2, 0, -2],
        y: [12, 0, -12, 0, 12],
      },
    },
    {
      frame: frame(196.92, 35.3, 63.336, 56.6),
      parts: [
        {
          source: require('@/src/assets/images/onboarding/slide1/coin-usdt.svg'),
          frame: frame(1.36, 2.75, 60.609, 51.1),
          size: [54.466, 27.003],
          transform: [{ rotate: '-30.83deg' }],
        },
        {
          source: require('@/src/assets/images/onboarding/slide1/logo-usdt.png'),
          frame: frame(9.57, 16.18, 44.615, 20.79),
          size: [24.637, 24.637],
          transform: [{ rotate: '27.65deg' }, { scaleY: 0.77 }, { skewX: '-40.03deg' }],
        },
      ],
      motion: {
        times: QUARTERS,
        rotate: [-0.05236, 0, 0.05236, 0, -0.05236],
        x: [2.5, 0, -2.5, 0, 2.5],
        y: [-11, 0, 11, 0, -11],
      },
    },
    {
      frame: frame(128.18, 0, 65.495, 46.782),
      parts: [
        {
          source: require('@/src/assets/images/onboarding/slide1/coin-xlm.svg'),
          frame: frame(1.27, 0.63, 62.954, 45.522),
          size: [56.809, 28.165],
          transform: [{ rotate: '160.49deg' }, { scaleY: -1 }],
        },
        {
          source: require('@/src/assets/images/onboarding/slide1/logo-xlm.png'),
          frame: frame(17.72, 11.86, 22.793, 23.197),
          size: [18.443, 18.443],
          transform: [{ rotate: '-17.35deg' }, { scaleY: 0.83 }, { skewX: '-33.69deg' }],
        },
      ],
      motion: {
        times: QUARTERS,
        rotate: [0, -0.043633, 0, 0.043633, 0],
        x: [0, 2, 0, -2, 0],
        y: [0, -9, 0, 9, 0],
      },
    },
    solo(
      require('@/src/assets/images/onboarding/slide1/sparkle-large.svg'),
      frame(304.66, 64.09, 17.648, 17.648),
    ),
    solo(
      require('@/src/assets/images/onboarding/slide1/sparkle-small.svg'),
      frame(76.17, 111.46, 7.431, 7.431),
    ),
    solo(
      require('@/src/assets/images/onboarding/slide1/wallet.svg'),
      frame(267.51, 117.04, 43.776, 43.776),
      {
        size: ICON_SIZE,
        transform: [{ rotate: '-9.372deg' }],
        imageInset: [12.5, 5.21, 14.58, 8.33],
        motion: {
          times: QUARTERS,
          rotate: [0, 0.034907, 0, -0.034907, 0],
          x: [0, -1.5, 0, 1.5, 0],
          y: [0, 8, 0, -8, 0],
        },
      },
    ),
    solo(
      require('@/src/assets/images/onboarding/slide1/money.svg'),
      frame(11.15, 111.46, 53.857, 53.857),
      {
        size: ICON_SIZE,
        transform: [{ rotate: '45.136deg' }],
        imageInset: MONEY_INSET,
        motion: {
          times: QUARTERS,
          rotate: [-0.043633, 0, 0.043633, 0, -0.043633],
          x: [1.8, 0, -1.8, 0, 1.8],
          y: [-9, 0, 9, 0, -9],
        },
      },
    ),
  ],
};

const slide2: Illustration = {
  artboard: frame(15, 94, 360, 360),
  clip: true,
  durationMs: 2400,
  layers: [
    solo(
      require('@/src/assets/images/onboarding/slide2/shadow.svg'),
      frame(109.0035, 298.152, 168.993, 27.216),
    ),
    solo(
      require('@/src/assets/images/onboarding/slide2/arm.svg'),
      slide2Box(53.61, 18.18, 29.88, 69.15),
    ),
    solo(
      require('@/src/assets/images/onboarding/slide2/detail-a.svg'),
      slide2Box(49.7, 80.15, 49.37, 18.57),
    ),
    solo(
      require('@/src/assets/images/onboarding/slide2/detail-b.svg'),
      slide2Box(48.15, 77.38, 50.83, 21.39),
    ),
    solo(
      require('@/src/assets/images/onboarding/slide2/legs.svg'),
      slide2Box(69.12, 32.78, 12.86, 42.54),
    ),
    solo(
      require('@/src/assets/images/onboarding/slide2/keys.svg'),
      slide2Box(35.15, 72.62, 49.44, 15.57),
      { motion: WOBBLE },
    ),
    solo(
      require('@/src/assets/images/onboarding/slide2/key-detail.svg'),
      slide2Box(50.18, 62.73, 44.46, 27.92),
    ),
    solo(
      require('@/src/assets/images/onboarding/slide2/body.svg'),
      slide2Box(12.99, 19.66, 30.19, 30.3),
    ),
    solo(
      require('@/src/assets/images/onboarding/slide2/eye-right.svg'),
      slide2Box(33.66, 31.71, 52.48, 52.65),
    ),
    solo(
      require('@/src/assets/images/onboarding/slide2/eye-left.svg'),
      slide2Box(33.52, 44.91, 52.93, 43.57),
    ),
    solo(
      require('@/src/assets/images/onboarding/slide2/wallet.svg'),
      frame(-3.8935, 119.22, 164.787, 166.882),
      { size: [113.945, 123.47], transform: [{ rotate: '-36.05deg' }], motion: WOBBLE },
    ),
    solo(
      require('@/src/assets/images/onboarding/slide2/mouth.svg'),
      slide2Box(54.7, 45.53, 38.55, 45.52),
    ),
    solo(
      require('@/src/assets/images/onboarding/slide2/coin.svg'),
      frame(278, 31, 70.561, 55.907),
      {
        size: [62.012, 41.348],
        transform: [{ rotate: '-14.906deg' }],
        motion: { times: [0, 0.5, 1], rotate: [0, -0.02618, 0], y: [0, -8, 0] },
      },
    ),
    solo(
      require('@/src/assets/images/onboarding/slide2/stars.svg'),
      frame(71, 57, 277.842, 60.842),
      { motion: STAR_DROP },
    ),
  ],
};

const slide3: Illustration = {
  artboard: frame(0, 0, 390, 844),
  durationMs: 4200,
  layers: [
    solo(
      require('@/src/assets/images/onboarding/slide3/cape.svg'),
      slide3Box(30.27, 9.23, 56.65, 41.21),
      {
        motion: {
          times: [0, 0.13095, 0.27381, 0.41667, 0.57143, 1],
          rotate: [0, 0.011345, -0.007854, 0.006109, 0, 0],
          scaleX: [1, 1.05, 0.975, 1.035, 1, 1],
          scaleY: [1, 0.99, 1.015, 0.985, 1, 1],
          x: [0, -4.8, 2.8, -3.2, 0, 0],
          y: [0, 1.4, -0.8, 1.8, 0, 0],
        },
      },
    ),
    solo(
      require('@/src/assets/images/onboarding/slide3/legs.svg'),
      slide3Box(19.69, 28.9, 51.08, 12.82),
    ),
    solo(
      require('@/src/assets/images/onboarding/slide3/body.svg'),
      slide3Box(16.59, 29.11, 61.55, 29.24),
    ),
    solo(
      require('@/src/assets/images/onboarding/slide3/coin.svg'),
      frame(213.77, 92.3, 63.336, 56.6),
      {
        size: [60.207, 53.018],
        transform: [{ rotate: '3.505deg' }],
        motion: { times: [0, 0.2619, 0.52381, 0.7619, 1], y: [0, -7, 0, 3, 0] },
      },
    ),
    solo(
      require('@/src/assets/images/onboarding/slide3/gift.svg'),
      frame(285.29, 181.49, 30.722, 30.722),
      {
        size: [26.727, 26.727],
        transform: [{ rotate: '-9.372deg' }],
        motion: { times: [0, 0.19048, 0.45238, 0.7381, 1], y: [0, 2.5, -6, 1.5, 0] },
      },
    ),
    solo(
      require('@/src/assets/images/onboarding/slide3/money.svg'),
      frame(28, 168.46, 53.857, 53.857),
      {
        size: ICON_SIZE,
        transform: [{ rotate: '45.136deg' }],
        imageInset: MONEY_INSET,
        motion: { times: [0, 0.21429, 0.47619, 0.71429, 1], y: [0, -6, 1.5, 4, 0] },
      },
    ),
    solo(
      require('@/src/assets/images/onboarding/slide3/star.svg'),
      frame(87, 110, 17.388, 17.388),
      { motion: { times: [0, 0.16667, 0.40476, 0.66667, 1], y: [0, 3, -5, 1, 0] } },
    ),
  ],
};

export const ONBOARDING_SLIDES: OnboardingSlide[] = [
  {
    id: 1,
    title: 'Latch isn’t just a\nwallet. A smart account.',
    description: 'Latch gives you programmable control over your money far beyond a single key.',
    descriptionWidth: 342,
    illustration: slide1,
  },
  {
    id: 2,
    title: 'Your money deserves\nmore than one key',
    description:
      'Sign with a passkey, share approvals with people you trust, and set rules that protect what matters.',
    descriptionWidth: 298,
    illustration: slide2,
  },
  {
    id: 3,
    title: 'One identity.\nMany smart accounts.',
    description: 'Spin up separate accounts for spending, saving and teams each with its own rules.',
    descriptionWidth: 322,
    illustration: slide3,
  },
];
