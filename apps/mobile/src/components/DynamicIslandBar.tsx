import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface IslandCallInfo {
  active: boolean;
  label?: string;
  speaking?: boolean;
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
        prev.label === next.label &&
        prev.speaking === next.speaking
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
 * Minimalist Dynamic Island-inspired floating top pill displaying only the
 * current time — seamlessly adding a subtle live cyan Aura pulse and timer
 * during active voice sessions.
 */
export function DynamicIslandBar() {
  const { callInfo } = useDynamicIsland();
  const insets = useSafeAreaInsets();
  const [timeText, setTimeText] = useState(() => formatClock(new Date()));
  const pulse = useRef(new Animated.Value(0.6)).current;
  const topOffset = insets.top > 0 ? insets.top + 4 : 16;

  useEffect(() => {
    const updateClock = () => setTimeText(formatClock(new Date()));
    updateClock();
    const timer = setInterval(updateClock, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!callInfo.active) {
      pulse.setValue(0.6);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: callInfo.speaking ? 450 : 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: callInfo.speaking ? 450 : 1000,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [callInfo.active, callInfo.speaking, pulse]);

  return (
    <View style={[styles.wrapper, { top: topOffset }]} pointerEvents="none">
      <View style={[styles.island, callInfo.active && styles.islandActive]}>
        {callInfo.active ? (
          <Animated.View style={[styles.liveDot, { opacity: pulse }]} />
        ) : null}

        <Text style={styles.timeText}>{timeText}</Text>

        {callInfo.active && callInfo.label ? (
          <>
            <View style={styles.divider} />
            <Text style={styles.callLabel}>{callInfo.label}</Text>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 90,
  },
  island: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 32,
    minWidth: 84,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#0A0A0D',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  islandActive: {
    borderColor: 'rgba(31, 213, 249, 0.28)',
    paddingHorizontal: 14,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#1FD5F9',
  },
  timeText: {
    color: '#F4F4F5',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  divider: {
    width: 1,
    height: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  callLabel: {
    color: '#1FD5F9',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
