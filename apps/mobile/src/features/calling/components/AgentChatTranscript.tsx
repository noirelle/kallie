import React, { memo, useCallback, useEffect, useRef } from 'react';
import { Animated, FlatList, StyleSheet, Text, View } from 'react-native';
import { AgentVisualizerState, CallChatMessage } from '../hooks/useLiveKitCall';

interface AgentChatTranscriptProps {
  messages: CallChatMessage[];
  agentState: AgentVisualizerState;
}

const ThinkingIndicator = memo(function ThinkingIndicator() {
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.9,
          duration: 720,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.3,
          duration: 720,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  return (
    <View style={styles.thinkingRow}>
      <Animated.View style={[styles.thinkingDot, { opacity: pulse }]} />
      <Animated.Text style={[styles.thinkingText, { opacity: pulse }]}>
        Thinking...
      </Animated.Text>
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
        <Text
          style={[styles.userText, isStreaming && styles.streamingText]}
        >
          {item.text}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.agentRow}>
      <Text
        style={[styles.agentText, isStreaming && styles.streamingAgentText]}
      >
        {item.text}
      </Text>
    </View>
  );
});

/**
 * Clean, borderless real-time Chat Transcript:
 * - Zero message bubbles, zero backgrounds, zero borders
 * - User spoken/typed words appear live on the right in subtle light gray
 * - Kallie's spoken responses stream live on the left in crisp white
 * - Smoothly auto-scrolls as words arrive in real time
 */
export const AgentChatTranscript = memo(function AgentChatTranscript({
  messages,
  agentState,
}: AgentChatTranscriptProps) {
  const listRef = useRef<FlatList<CallChatMessage>>(null);

  const scrollToLatest = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
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
      ListEmptyComponent={
        agentState === 'thinking' ? undefined : (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>Speak or type below</Text>
          </View>
        )
      }
      ListFooterComponent={agentState === 'thinking' ? <ThinkingIndicator /> : undefined}
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
    gap: 22,
    flexGrow: 1,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#52525B',
    fontSize: 14,
    textAlign: 'center',
  },
  agentRow: {
    alignSelf: 'flex-start',
    maxWidth: '90%',
  },
  agentText: {
    color: '#FAFAFA',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
    letterSpacing: -0.1,
  },
  streamingAgentText: {
    color: '#E4E4E7',
  },
  userRow: {
    alignSelf: 'flex-end',
    maxWidth: '84%',
  },
  userText: {
    color: '#A1A1AA',
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '400',
    textAlign: 'right',
    letterSpacing: -0.1,
  },
  streamingText: {
    color: '#D4D4D8',
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
  },
  thinkingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#71717A',
  },
  thinkingText: {
    color: '#71717A',
    fontSize: 14,
    fontWeight: '400',
  },
});
