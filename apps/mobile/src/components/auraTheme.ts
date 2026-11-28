import { AgentVisualizerState } from '../features/calling/hooks/useDirectVoiceSession';

export type AuraConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'weak'
  | 'disconnected';

export interface AuraColorPalette {
  primary: string;
  secondary: string;
  highlight: string;
  coreBase: string;
  coreMid: string;
  coreGlow: string;
  rimRgba: string;
  glowRgba: string;
  label: string;
  description: string;
}

export const AURA_STATUS_PALETTES: Record<
  Exclude<AuraConnectionStatus, 'idle'>,
  AuraColorPalette
> = {
  connecting: {
    primary: '#E4E4E7',
    secondary: '#71717A',
    highlight: '#FFFFFF',
    coreBase: '#18181C',
    coreMid: '#52525B',
    coreGlow: '#E4E4E7',
    rimRgba: 'rgba(255, 255, 255, 0.36)',
    glowRgba: 'rgba(255, 255, 255, 0.34)',
    label: 'Silver',
    description: 'Connecting',
  },
  connected: {
    primary: '#FFFFFF',
    secondary: '#B4B4BC',
    highlight: '#FFFFFF',
    coreBase: '#1E1E24',
    coreMid: '#71717A',
    coreGlow: '#FFFFFF',
    rimRgba: 'rgba(255, 255, 255, 0.56)',
    glowRgba: 'rgba(255, 255, 255, 0.48)',
    label: 'White',
    description: 'Ready',
  },
  weak: {
    primary: '#A1A1AA',
    secondary: '#52525B',
    highlight: '#D4D4D8',
    coreBase: '#131317',
    coreMid: '#3F3F46',
    coreGlow: '#A1A1AA',
    rimRgba: 'rgba(255, 255, 255, 0.24)',
    glowRgba: 'rgba(255, 255, 255, 0.22)',
    label: 'Dim',
    description: 'Weak signal',
  },
  disconnected: {
    primary: '#52525B',
    secondary: '#27272A',
    highlight: '#71717A',
    coreBase: '#0D0D10',
    coreMid: '#27272A',
    coreGlow: '#52525B',
    rimRgba: 'rgba(255, 255, 255, 0.14)',
    glowRgba: 'rgba(255, 255, 255, 0.14)',
    label: 'Muted',
    description: 'Standby',
  },
};

export const AURA_IDLE_PALETTE: AuraColorPalette = {
  primary: '#F4F4F5',
  secondary: '#8E8E98',
  highlight: '#FFFFFF',
  coreBase: '#17171C',
  coreMid: '#52525B',
  coreGlow: '#F4F4F5',
  rimRgba: 'rgba(255, 255, 255, 0.40)',
  glowRgba: 'rgba(255, 255, 255, 0.34)',
  label: 'Idle',
  description: 'Standby',
};

export const AURA_DEMO_SEQUENCE: Array<Exclude<AuraConnectionStatus, 'idle'>> = [
  'connecting',
  'connected',
  'weak',
  'disconnected',
];

export function resolveAuraPalette(
  connectionStatus?: AuraConnectionStatus,
  _colorOverride?: string,
): AuraColorPalette {
  if (!connectionStatus || connectionStatus === 'idle') {
    return AURA_IDLE_PALETTE;
  }
  return AURA_STATUS_PALETTES[connectionStatus];
}

export type AuraAgentState = AgentVisualizerState;
