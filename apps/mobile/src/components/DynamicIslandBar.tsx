import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AgentAuraVisualizer } from '../features/calling/components/AgentAuraVisualizer';
import { AgentVisualizerState } from '../features/calling/hooks/useLiveKitCall';

export interface IslandCallInfo {
  active: boolean;
  timer?: string;
  agentState?: AgentVisualizerState;
  audioLevel?: number;
}

interface DynamicIslandContextValue {
  callInfo: IslandCallInfo;
  setCallInfo: (next: IslandCallInfo) => void;
}

const DynamicIslandContext = createContext<DynamicIslandContextValue>({
  callInfo: { active: false },
  setCallInfo: () => {},
});

export function DynamicIslandProvider({ children }: { children: ReactNode }) {
  const [callInfo, setCallInfoState] = useState<IslandCallInfo>({ active: false });

  const setCallInfo = useCallback((next: IslandCallInfo) => {
    setCallInfoState((prev) => {
      if (
        prev.active === next.active &&
        prev.timer === next.timer &&
        prev.agentState === next.agentState &&
        prev.audioLevel === next.audioLevel
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ callInfo, setCallInfo }), [callInfo, setCallInfo]);

  return (
    <DynamicIslandContext.Provider value={value}>
      {children}
    </DynamicIslandContext.Provider>
  );
}

export function useDynamicIsland() {
  return useContext(DynamicIslandContext);
}

function formatClock(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const h12 = hours % 12 || 12;
  return `${h12}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Dynamic Island-style floating horizontal pill:
 * - Active voice session: scaled-down live cyan/blue Aura visualizer on the left
 *   and live session timer (e.g., 01:45) on the right.
 * - Outside a call: minimalist pill showing only the live local time.
 */
export function DynamicIslandBar() {
  const { callInfo } = useDynamicIsland();
  const insets = useSafeAreaInsets();
  const [timeText, setTimeText] = useState(() => formatClock(new Date()));
  const topOffset = insets.top > 0 ? insets.top + 4 : 16;

  useEffect(() => {
    const updateClock = () => setTimeText(formatClock(new Date()));
    updateClock();
    const timer = setInterval(updateClock, 10000);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={[styles.wrapper, { top: topOffset }]} pointerEvents="none">
      {callInfo.active ? (
        <View style={[styles.island, styles.islandSession]}>
          <AgentAuraVisualizer
            state={callInfo.agentState ?? 'connecting'}
            audioLevel={callInfo.audioLevel ?? 0.16}
            size="xs"
          />
          <Text style={styles.sessionTimer}>{callInfo.timer ?? '00:00'}</Text>
        </View>
      ) : (
        <View style={styles.island}>
          <Text style={styles.timeText}>{timeText}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 90,
  },
  island: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 34,
    minWidth: 84,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#0A0A0D',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  islandSession: {
    justifyContent: 'space-between',
    minWidth: 124,
    height: 38,
    paddingLeft: 10,
    paddingRight: 16,
    gap: 14,
    borderColor: 'rgba(31, 213, 249, 0.24)',
  },
  timeText: {
    color: '#F4F4F5',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  sessionTimer: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
    fontVariant: ['tabular-nums'],
  },
});
