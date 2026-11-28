import React, { memo, useCallback, useEffect, useRef } from 'react';
import { Animated, FlatList, StyleSheet, Text, View } from 'react-native';
import { FONT, MONO } from '../../../theme/monoTheme';
import { AgentVisualizerState, CallChatMessage } from '../hooks/useDirectVoiceSession';

interface AgentChatTranscriptProps {
  messages: CallChatMessage[];
  agentState: AgentVisualizerState;
}

/**
 * Minimalist 3-dot monochrome breathing pulse — zero redundant text.
 */
const ThinkingIndicator = memo(function ThinkingIndicator() {
  const dotA = useRef(new Animated.Value(0.25)).current;
  const dotB = useRef(new Animated.Value(0.25)).current;
  const dotC = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    const createWave = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, {
            toValue: 0.95,
            duration: 420,
            useNativeDriver: true,
          }),
          Animated.timing(val, {
            toValue: 0.22,
            duration: 420,
            useNativeDriver: true,
          }),
          Animated.delay(Math.max(0, 360 - delay)),
        ]),
      );

    const animA = createWave(dotA, 0);
    const animB = createWave(dotB, 140);
    const animC = createWave(dotC, 280);
    animA.start();
    animB.start();
    animC.start();

    return () => {
      animA.stop();
      animB.stop();
      animC.stop();
    };
  }, [dotA, dotB, dotC]);

  return (
    <View style={styles.thinkingRow} accessibilityLabel="Thinking">
      <Animated.View style={[styles.thinkingDot, { opacity: dotA }]} />
      <Animated.View style={[styles.thinkingDot, { opacity: dotB }]} />
      <Animated.View style={[styles.thinkingDot, { opacity: dotC }]} />
    </View>
  );
});

const TranscriptItem = memo(function TranscriptItem({
  item,
}: {
  item: CallChatMessage;
}) {
  const isUser = item.sender === 'user';
  const isStreaming = item.isFinal === false;

  if (isUser) {
    return (
      <View style={styles.userRow}>
        <Text style={[styles.userText, isStreaming && styles.streamingText]}>
          {item.text}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.agentRow}>
      <Text style={[styles.agentText, isStreaming && styles.streamingAgentText]}>
        {item.text}
      </Text>
    </View>
  );
});

/**
 * Clean, borderless real-time Chat Transcript:
 * - Zero message bubbles, zero instructional placeholder copy
 * - User spoken/typed words appear on the right in neutral gray
 * - Kallie's spoken responses stream on the left in crisp white Geist
 */
export const AgentChatTranscript = memo(function AgentChatTranscript({
  messages,
  agentState,
}: AgentChatTranscriptProps) {
  const listRef = useRef<FlatList<CallChatMessage>>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToLatest = useCallback(() => {
    if (scrollTimerRef.current) return;
    scrollTimerRef.current = setTimeout(() => {
      scrollTimerRef.current = null;
      listRef.current?.scrollToEnd({ animated: true });
    }, 140);
  }, []);

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (agentState === 'thinking') {
      scrollToLatest();
    }
  }, [agentState, scrollToLatest]);

  const renderItem = useCallback(
    ({ item }: { item: CallChatMessage }) => <TranscriptItem item={item} />,
    [],
  );

  const keyExtractor = useCallback((item: CallChatMessage) => item.id, []);

  return (
    <FlatList
      ref={listRef}
      style={styles.list}
      data={messages}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={scrollToLatest}
      removeClippedSubviews={false}
      ListFooterComponent={agentState === 'thinking' ? ThinkingIndicator : undefined}
    />
  );
});

const styles = StyleSheet.create({
  list: {
    flex: 1,
    width: '100%',
  },
  listContent: {
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 20,
    flexGrow: 1,
  },
  agentRow: {
    alignSelf: 'flex-start',
    maxWidth: '90%',
  },
  agentText: {
    fontFamily: FONT.regular,
    color: '#FAFAFA',
    fontSize: 15.5,
    lineHeight: 23,
    letterSpacing: -0.15,
  },
  streamingAgentText: {
    color: '#D4D4D8',
  },
  userRow: {
    alignSelf: 'flex-end',
    maxWidth: '84%',
  },
  userText: {
    fontFamily: FONT.regular,
    color: MONO.textSecondary,
    fontSize: 14.5,
    lineHeight: 22,
    textAlign: 'right',
    letterSpacing: -0.1,
  },
  streamingText: {
    color: '#D4D4D8',
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  thinkingDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: MONO.textSecondary,
  },
});
