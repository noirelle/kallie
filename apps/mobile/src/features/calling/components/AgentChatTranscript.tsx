import React, { useEffect, useRef } from 'react';
import { Animated, FlatList, StyleSheet, Text, View } from 'react-native';
import { AgentVisualizerState, CallChatMessage } from '../hooks/useLiveKitCall';

interface AgentChatTranscriptProps {
  messages: CallChatMessage[];
  agentState: AgentVisualizerState;
}

function ThinkingIndicator() {
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 750,
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
}

/**
 * LiveKit Agents UI-inspired borderless Chat Transcript:
 * - Agent turns render as clean left-aligned ghost text rows
 * - User turns render as right-aligned dark rounded secondary bubbles
 * - Live pulsing "Thinking..." indicator appears while Kallie is responding
 */
export function AgentChatTranscript({
  messages,
  agentState,
}: AgentChatTranscriptProps) {
  const listRef = useRef<FlatList<CallChatMessage>>(null);

  useEffect(() => {
    if (messages.length > 0 || agentState === 'thinking') {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, [agentState, messages]);

  return (
    <FlatList
      ref={listRef}
      style={styles.list}
      data={messages}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={
        agentState === 'thinking' ? undefined : (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>
              Speak or type below — live transcript appears here.
            </Text>
          </View>
        )
      }
      ListFooterComponent={agentState === 'thinking' ? <ThinkingIndicator /> : undefined}
      renderItem={({ item }) => {
        const isUser = item.sender === 'user';
        if (isUser) {
          return (
            <View style={styles.userRow}>
              <View style={styles.userBubble}>
                <Text style={styles.userText}>{item.text}</Text>
              </View>
            </View>
          );
        }

        return (
          <View style={styles.agentRow}>
            <Text style={styles.agentText}>{item.text}</Text>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    width: '100%',
  },
  listContent: {
    paddingHorizontal: 4,
    paddingTop: 12,
    paddingBottom: 20,
    gap: 20,
    flexGrow: 1,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    color: '#52525B',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  agentRow: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
  },
  agentText: {
    color: '#FAFAFA',
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '400',
  },
  userRow: {
    alignSelf: 'flex-end',
    maxWidth: '82%',
  },
  userBubble: {
    backgroundColor: '#1C1C1F',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  userText: {
    color: '#FAFAFA',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  thinkingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#71717A',
  },
  thinkingText: {
    color: '#71717A',
    fontSize: 14,
    fontWeight: '500',
  },
});
