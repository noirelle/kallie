import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CallChatMessage } from '../hooks/useLiveKitCall';
import { SendIcon } from './CallIcons';

interface CallChatDrawerProps {
  messages: CallChatMessage[];
  onSend: (text: string) => Promise<void>;
}

export function CallChatDrawer({ messages, onSend }: CallChatDrawerProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<CallChatMessage>>(null);

  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, [messages]);

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setDraft('');
    try {
      await onSend(trimmed);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.wrapper}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={16}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>LIVE CHAT & TRANSCRIPT</Text>
        <Text style={styles.headerCount}>{messages.length}</Text>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            Speak or type below — live transcript and chat messages appear here.
          </Text>
        }
        renderItem={({ item }) => {
          const isUser = item.sender === 'user';
          return (
            <View style={[styles.row, isUser ? styles.rowUser : styles.rowKallie]}>
              <Text style={styles.senderLabel}>{isUser ? 'YOU' : 'KALLIE'}</Text>
              <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleKallie]}>
                <Text style={[styles.bubbleText, isUser ? styles.textUser : styles.textKallie]}>
                  {item.text}
                </Text>
              </View>
            </View>
          );
        }}
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message Kallie..."
          placeholderTextColor="#52525B"
          returnKeyType="send"
          onSubmitEditing={handleSend}
          editable={!sending}
        />
        <Pressable
          style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!draft.trim() || sending}
          accessibilityLabel="Send message"
        >
          <SendIcon color="#000000" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: '#050505',
    marginVertical: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerTitle: {
    color: '#A1A1AA',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  headerCount: {
    color: '#52525B',
    fontSize: 10,
    fontWeight: '700',
  },
  listContent: {
    padding: 14,
    gap: 12,
    flexGrow: 1,
  },
  emptyText: {
    color: '#52525B',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 18,
  },
  row: {
    maxWidth: '88%',
    gap: 4,
  },
  rowUser: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  rowKallie: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  senderLabel: {
    color: '#52525B',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
  },
  bubbleUser: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  bubbleKallie: {
    backgroundColor: '#0E0E0E',
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  bubbleText: {
    fontSize: 13,
    lineHeight: 19,
  },
  textUser: {
    color: '#000000',
    fontWeight: '500',
  },
  textKallie: {
    color: '#FAFAFA',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: '#000000',
    padding: 8,
    gap: 8,
  },
  input: {
    flex: 1,
    color: '#FAFAFA',
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  sendBtn: {
    width: 38,
    height: 38,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.35,
  },
});
