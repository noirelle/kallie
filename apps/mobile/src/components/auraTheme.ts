import { AgentVisualizerState } from '../features/calling/hooks/useLiveKitCall';

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
  glowRgba: string;
  label: string;
  description: string;
}

export const AURA_STATUS_PALETTES: Record<
  Exclude<AuraConnectionStatus, 'idle'>,
  AuraColorPalette
> = {
  connecting: {
    primary: '#22C55E',
    secondary: '#10B981',
    highlight: '#86EFAC',
    glowRgba: 'rgba(34, 197, 94, 0.55)',
    label: 'Green',
    description: 'Connecting',
  },
  connected: {
    primary: '#1FD5F9',
    secondary: '#3B82F6',
    highlight: '#A5F3FC',
    glowRgba: 'rgba(31, 213, 249, 0.55)',
    label: 'Blue',
    description: 'Connected & ready',
  },
  weak: {
    primary: '#FACC15',
    secondary: '#F59E0B',
    highlight: '#FEF08A',
    glowRgba: 'rgba(250, 204, 21, 0.52)',
    label: 'Yellow',
    description: 'Weak connection',
  },
  disconnected: {
    primary: '#EF4444',
    secondary: '#DC2626',
    highlight: '#FCA5A5',
    glowRgba: 'rgba(239, 68, 68, 0.55)',
    label: 'Red',
    description: 'Disconnected',
  },
};

export const AURA_DEMO_SEQUENCE: Array<Exclude<AuraConnectionStatus, 'idle'>> = [
  'connecting',
  'connected',
  'weak',
  'disconnected',
];

export function resolveAuraPalette(
  connectionStatus?: AuraConnectionStatus,
  colorOverride?: string,
): AuraColorPalette {
  if (connectionStatus && connectionStatus !== 'idle') {
    return AURA_STATUS_PALETTES[connectionStatus];
  }

  if (colorOverride) {
    const normalized = colorOverride.trim().toLowerCase();
    for (const palette of Object.values(AURA_STATUS_PALETTES)) {
      if (palette.primary.toLowerCase() === normalized) {
        return palette;
      }
    }
    return {
      primary: colorOverride,
      secondary: '#3B82F6',
      highlight: '#A5F3FC',
      glowRgba: 'rgba(31, 213, 249, 0.52)',
      label: 'Blue',
      description: 'Connected & ready',
    };
  }

  return AURA_STATUS_PALETTES.connected;
}

export type AuraAgentState = AgentVisualizerState;
