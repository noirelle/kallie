import { TextStyle } from 'react-native';

/**
 * Unified Pure Monochrome Design Tokens for Kallie Mobile.
 * Strict black-and-white palette with neutral grays for depth, hairline borders,
 * disciplined Geist typography, and restrained tactile motion.
 */
export const MONO = {
  bg: '#000000',
  surface: '#0A0A0A',
  surfaceElevated: '#111111',
  surfaceRaised: '#141414',
  surfacePressed: '#1D1D1F',
  border: 'rgba(255, 255, 255, 0.10)',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  borderStrong: 'rgba(255, 255, 255, 0.22)',
  borderActive: '#FFFFFF',
  textPrimary: '#FFFFFF',
  textSecondary: '#9898A0',
  textMuted: '#5C5C66',
  white: '#FFFFFF',
  black: '#000000',
  whiteSoft: 'rgba(255, 255, 255, 0.14)',
  whiteWash: 'rgba(255, 255, 255, 0.05)',
  dangerBorder: 'rgba(255, 255, 255, 0.24)',
} as const;

export const FONT = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  mono: 'GeistMono_400Regular',
} as const;

/**
 * Disciplined Typographic Scale.
 * Static Geist weights omit `fontWeight` so Android never synthesizes faux-bold.
 */
export const TYPE = {
  display: {
    fontFamily: FONT.medium,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.75,
  },
  title: {
    fontFamily: FONT.medium,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.45,
  },
  heading: {
    fontFamily: FONT.medium,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: FONT.regular,
    fontSize: 14.5,
    lineHeight: 21,
    letterSpacing: -0.1,
  },
  bodyMedium: {
    fontFamily: FONT.medium,
    fontSize: 14.5,
    lineHeight: 20,
    letterSpacing: -0.15,
  },
  label: {
    fontFamily: FONT.medium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: -0.05,
  },
  caption: {
    fontFamily: FONT.regular,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0.05,
  },
  eyebrow: {
    fontFamily: FONT.medium,
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 1.35,
    textTransform: 'uppercase',
  },
  mono: {
    fontFamily: FONT.mono,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0.1,
  },
  button: {
    fontFamily: FONT.semibold,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: -0.15,
  },
} satisfies Record<string, TextStyle>;

export const RADIUS = {
  xs: 8,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

export const SPACE = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
} as const;

export const MOTION = {
  fast: 150,
  normal: 240,
  slow: 340,
  holdToSettingsMs: 460,
  springSnappy: {
    stiffness: 380,
    damping: 30,
    mass: 0.85,
  },
  springSmooth: {
    stiffness: 260,
    damping: 26,
    mass: 0.9,
  },
} as const;
