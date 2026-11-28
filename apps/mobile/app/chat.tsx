import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SlidersIcon, SparkIcon } from '../src/components/MonoIcons';
import { MonoHeader, MonoPressable } from '../src/components/MonoUi';
import { runLocalCompanionTurn } from '../src/features/ai/lib/agentOrchestrator';
import {
  getConversationMessagesSync,
  getOrCreateDefaultConversationSync,
} from '../src/features/ai/lib/conversationRepository';
import {
  getActiveAiProviderSync,
  subscribeAiProviders,
} from '../src/features/ai/lib/providerStore';
import { SendIcon } from '../src/features/calling/components/CallIcons';
import { MONO, RADIUS, TYPE } from '../src/theme/monoTheme';
import { ChatMessageRecord } from '../src/types/database';

export default function LocalChatScreen() {
  const router = useRouter();
  const [provider, setProvider] = useState(() => getActiveAiProviderSync());
  const conversationRef = useRef(
    getOrCreateDefaultConversationSync(provider?.id ?? null, provider?.defaultModel ?? null),
  );
  const [messages, setMessages] = useState<ChatMessageRecord[]>(() =>
    getConversationMessagesSync(conversationRef.current.id),
  );
  const [draft, setDraft] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [toolActivity, setToolActivity] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    return subscribeAiProviders(() => {
      setProvider(getActiveAiProviderSync());
    });
  }, []);

  const refreshMessages = useCallback(() => {
    setMessages(getConversationMessagesSync(conversationRef.current.id));
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;

    if (!provider) {
      router.push('/settings');
      return;
    }

    setDraft('');
    setErrorMsg(null);
    setSending(true);
    setStreamingText('');
    setToolActivity(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await runLocalCompanionTurn(
        conversationRef.current.id,
        trimmed,
        {
          onTextDelta: (acc) => setStreamingText(acc),
          onToolActivity: (toolName) => setToolActivity(toolName),
        },
        controller.signal,
      );
      refreshMessages();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Request failed');
      refreshMessages();
    } finally {
      abortRef.current = null;
      setSending(false);
      setStreamingText('');
      setToolActivity(null);
    }
  }, [draft, provider, refreshMessages, router, sending]);

  const canSend = Boolean(draft.trim()) && !sending;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <MonoHeader
        title="Kallie"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        rightSlot={
          <MonoPressable
            onPress={() => router.push('/settings')}
            hitSlop={10}
            scaleTo={0.92}
            style={styles.iconCircle}
            accessibilityLabel="Settings"
          >
            <SlidersIcon color={MONO.white} size={16} />
          </MonoPressable>
        }
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {!provider ? (
          <View style={styles.emptySetup}>
            <SparkIcon color={MONO.white} size={24} />
            <MonoPressable
              style={styles.setupBtn}
              onPress={() => router.push('/settings')}
            >
              <Text style={styles.setupBtnText}>Connect AI</Text>
            </MonoPressable>
          </View>
        ) : (
          <FlatList
            data={messages.filter((m) => m.role === 'user' || m.role === 'assistant')}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <View
                style={[
                  styles.bubble,
                  item.role === 'user' ? styles.userBubble : styles.assistantBubble,
                ]}
              >
                <Text
                  style={[
                    styles.bubbleText,
                    item.role === 'user' ? styles.userText : styles.assistantText,
                  ]}
                >
                  {item.content}
                </Text>
              </View>
            )}
            ListFooterComponent={
              sending ? (
                <View style={[styles.bubble, styles.assistantBubble]}>
                  {toolActivity ? (
                    <Text style={styles.toolBadge}>{toolActivity}</Text>
                  ) : null}
                  {streamingText ? (
                    <Text style={styles.assistantText}>{streamingText}</Text>
                  ) : (
                    <ActivityIndicator size="small" color={MONO.white} />
                  )}
                </View>
              ) : errorMsg ? (
                <Text style={styles.errorText}>{errorMsg}</Text>
              ) : undefined
            }
          />
        )}

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor={MONO.textMuted}
            returnKeyType="send"
            onSubmitEditing={() => void handleSend()}
            editable={!sending}
          />
          <MonoPressable
            style={[styles.sendBtn, canSend && styles.sendBtnActive]}
            scaleTo={0.92}
            onPress={() => void handleSend()}
            disabled={!canSend}
            accessibilityLabel="Send"
          >
            <SendIcon color={canSend ? MONO.black : MONO.textMuted} size={18} />
          </MonoPressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: MONO.bg },
  flex: { flex: 1 },
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
  listContent: { paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  bubble: {
    maxWidth: '84%',
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 20,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: MONO.white,
    borderBottomRightRadius: 6,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
    borderBottomLeftRadius: 6,
  },
  bubbleText: {
    ...TYPE.body,
  },
  userText: { color: MONO.black },
  assistantText: { color: MONO.textPrimary },
  toolBadge: {
    ...TYPE.eyebrow,
    color: MONO.textSecondary,
    marginBottom: 4,
  },
  errorText: {
    ...TYPE.caption,
    color: MONO.textSecondary,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  emptySetup: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  setupBtn: {
    backgroundColor: MONO.white,
    paddingHorizontal: 24,
    height: 46,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setupBtnText: {
    ...TYPE.button,
    color: MONO.black,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: MONO.border,
    backgroundColor: MONO.bg,
  },
  input: {
    ...TYPE.body,
    flex: 1,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 16,
    height: 44,
    color: MONO.textPrimary,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: MONO.surfaceElevated,
    borderWidth: 1,
    borderColor: MONO.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnActive: {
    backgroundColor: MONO.white,
    borderColor: MONO.white,
  },
});
