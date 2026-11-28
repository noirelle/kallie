import React, { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { MONO, MOTION, RADIUS, TYPE } from '../theme/monoTheme';
import { ChevronLeftIcon, ChevronRightIcon } from './MonoIcons';

interface MonoPressableProps extends Omit<PressableProps, 'style'> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
}

/**
 * Tactile monochrome pressable with smooth GPU spring compression.
 */
export function MonoPressable({
  children,
  style,
  scaleTo = 0.97,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: MonoPressableProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(
    (e: Parameters<NonNullable<PressableProps['onPressIn']>>[0]) => {
      Animated.spring(scale, {
        toValue: scaleTo,
        useNativeDriver: true,
        ...MOTION.springSnappy,
      }).start();
      onPressIn?.(e);
    },
    [onPressIn, scale, scaleTo],
  );

  const handlePressOut = useCallback(
    (e: Parameters<NonNullable<PressableProps['onPressOut']>>[0]) => {
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        ...MOTION.springSnappy,
      }).start();
      onPressOut?.(e);
    },
    [onPressOut, scale],
  );

  return (
    <Pressable
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      {...rest}
    >
      <Animated.View style={[style, disabled && styles.disabled, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

interface MonoHeaderProps {
  title: string;
  onBack?: () => void;
  rightSlot?: ReactNode;
}

export function MonoHeader({ title, onBack, rightSlot }: MonoHeaderProps) {
  const titleAnim = useRef(new Animated.Value(1)).current;
  const prevTitleRef = useRef(title);

  useEffect(() => {
    if (prevTitleRef.current !== title) {
      prevTitleRef.current = title;
      titleAnim.setValue(0);
      Animated.timing(titleAnim, {
        toValue: 1,
        duration: MOTION.fast,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [title, titleAnim]);

  const translateY = titleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [4, 0],
  });

  return (
    <View style={styles.header}>
      {onBack ? (
        <MonoPressable
          onPress={onBack}
          hitSlop={10}
          scaleTo={0.92}
          style={styles.iconCircle}
          accessibilityLabel="Back"
        >
          <ChevronLeftIcon color={MONO.white} size={18} />
        </MonoPressable>
      ) : (
        <View style={styles.headerSpacer} />
      )}

      <Animated.Text
        style={[
          styles.headerTitle,
          { opacity: titleAnim, transform: [{ translateY }] },
        ]}
        numberOfLines={1}
      >
        {title}
      </Animated.Text>

      <View style={styles.headerRight}>
        {rightSlot || <View style={styles.headerSpacer} />}
      </View>
    </View>
  );
}

interface MonoSwitchProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}

export function MonoSwitch({ value, onValueChange, disabled = false }: MonoSwitchProps) {
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: value ? 1 : 0,
      useNativeDriver: true,
      ...MOTION.springSnappy,
    }).start();
  }, [anim, value]);

  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 20],
  });

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      style={[
        styles.switchTrack,
        value && styles.switchTrackOn,
        disabled && styles.switchDisabled,
      ]}
    >
      <Animated.View
        style={[
          styles.switchThumb,
          value && styles.switchThumbOn,
          { transform: [{ translateX }] },
        ]}
      />
    </Pressable>
  );
}

interface MonoStatusDotProps {
  active: boolean;
}

export function MonoStatusDot({ active }: MonoStatusDotProps) {
  return <View style={[styles.dot, active ? styles.dotOn : styles.dotOff]} />;
}

interface FadeSlideViewProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  offsetY?: number;
  delay?: number;
}

export function FadeSlideView({
  children,
  style,
  offsetY = 8,
  delay = 0,
}: FadeSlideViewProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: MOTION.normal,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [delay, progress]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [offsetY, 0],
  });

  return (
    <Animated.View style={[style, { opacity: progress, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

interface MonoSectionCardProps {
  eyebrow?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Grouped surface container with crisp hairline border and optional quiet eyebrow.
 */
export function MonoSectionCard({ eyebrow, children, style }: MonoSectionCardProps) {
  return (
    <View style={styles.sectionBlock}>
      {eyebrow ? <Text style={styles.sectionEyebrow}>{eyebrow}</Text> : null}
      <View style={[styles.sectionCard, style]}>{children}</View>
    </View>
  );
}

export function MonoDivider({ inset = 16 }: { inset?: number }) {
  return <View style={[styles.divider, { marginHorizontal: inset }]} />;
}

interface MonoDisclosureProps {
  label: string;
  open: boolean;
  onToggle: () => void;
  leftIcon?: ReactNode;
}

/**
 * Minimalist disclosure trigger with smooth 90° rotating chevron.
 */
export function MonoDisclosure({
  label,
  open,
  onToggle,
  leftIcon,
}: MonoDisclosureProps) {
  const rot = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(rot, {
      toValue: open ? 1 : 0,
      useNativeDriver: true,
      ...MOTION.springSnappy,
    }).start();
  }, [open, rot]);

  const rotate = rot.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });

  return (
    <Pressable
      style={({ pressed }) => [styles.disclosureBtn, pressed && styles.disclosurePressed]}
      onPress={onToggle}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
    >
      <View style={styles.disclosureLeft}>
        {leftIcon}
        <Text style={[styles.disclosureLabel, open && styles.disclosureLabelOpen]}>
          {label}
        </Text>
      </View>
      <Animated.View style={{ transform: [{ rotate }] }}>
        <ChevronRightIcon color={open ? MONO.white : MONO.textMuted} size={14} />
      </Animated.View>
    </Pressable>
  );
}

export interface SegmentedDockItem<T extends string> {
  id: T;
  label: string;
  renderIcon: (active: boolean) => ReactNode;
}

interface MonoSegmentedDockProps<T extends string> {
  items: Array<SegmentedDockItem<T>>;
  activeId: T;
  onSelect: (id: T) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Spring-animated monochrome icon dock with sliding active pill indicator.
 */
export function MonoSegmentedDock<T extends string>({
  items,
  activeId,
  onSelect,
  style,
}: MonoSegmentedDockProps<T>) {
  const [innerWidth, setInnerWidth] = useState(0);
  const activeIndex = Math.max(
    0,
    items.findIndex((i) => i.id === activeId),
  );
  const indicatorX = useRef(new Animated.Value(0)).current;
  const initializedRef = useRef(false);

  const slotWidth = innerWidth > 0 && items.length > 0 ? innerWidth / items.length : 0;

  useEffect(() => {
    if (slotWidth <= 0) return;
    const target = activeIndex * slotWidth;
    if (!initializedRef.current) {
      initializedRef.current = true;
      indicatorX.setValue(target);
      return;
    }
    Animated.spring(indicatorX, {
      toValue: target,
      useNativeDriver: true,
      ...MOTION.springSmooth,
    }).start();
  }, [activeIndex, indicatorX, slotWidth]);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const measured = e.nativeEvent.layout.width;
    if (measured > 0) {
      setInnerWidth(measured);
    }
  }, []);

  return (
    <View style={[styles.dockOuter, style]}>
      <View style={styles.dockInner} onLayout={handleLayout}>
        {slotWidth > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.dockIndicator,
              {
                width: slotWidth,
                transform: [{ translateX: indicatorX }],
              },
            ]}
          />
        ) : null}

        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <Pressable
              key={item.id}
              style={styles.dockItem}
              onPress={() => onSelect(item.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
            >
              {item.renderIcon(active)}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  disabled: {
    opacity: 0.45,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 36,
    height: 36,
  },
  headerTitle: {
    ...TYPE.heading,
    color: MONO.textPrimary,
  },
  headerRight: {
    minWidth: 36,
    alignItems: 'flex-end',
  },
  switchTrack: {
    width: 46,
    height: 26,
    borderRadius: RADIUS.pill,
    backgroundColor: MONO.surfacePressed,
    borderWidth: 1,
    borderColor: MONO.border,
    padding: 2,
    justifyContent: 'center',
  },
  switchTrackOn: {
    backgroundColor: MONO.white,
    borderColor: MONO.white,
  },
  switchDisabled: {
    opacity: 0.4,
  },
  switchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: MONO.textSecondary,
  },
  switchThumbOn: {
    backgroundColor: MONO.black,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotOn: {
    backgroundColor: MONO.white,
  },
  dotOff: {
    borderWidth: 1.4,
    borderColor: MONO.textMuted,
    backgroundColor: 'transparent',
  },
  sectionBlock: {
    gap: 8,
  },
  sectionEyebrow: {
    ...TYPE.eyebrow,
    color: MONO.textMuted,
    paddingHorizontal: 4,
  },
  sectionCard: {
    borderRadius: RADIUS.lg,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
    overflow: 'hidden',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: MONO.border,
  },
  disclosureBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  disclosurePressed: {
    opacity: 0.7,
  },
  disclosureLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  disclosureLabel: {
    ...TYPE.label,
    color: MONO.textMuted,
  },
  disclosureLabelOpen: {
    color: MONO.textSecondary,
  },
  dockOuter: {
    marginHorizontal: 20,
    marginBottom: 8,
    padding: 4,
    borderRadius: RADIUS.pill,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
  },
  dockInner: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  dockIndicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: RADIUS.pill,
    backgroundColor: MONO.white,
  },
  dockItem: {
    flex: 1,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
