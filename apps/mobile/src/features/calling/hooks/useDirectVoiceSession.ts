import { useCallback, useEffect, useRef, useState } from 'react';
import { AuraConnectionStatus } from '../../../components/auraTheme';
import { formatSafeError } from '../../../lib/errors';
import { generateUuidV4 } from '../../../lib/id';
import { TranscriptEntry } from '../../../types/database';
import {
  getActiveAiProviderSync,
  getProviderApiKey,
  listAiProvidersSync,
} from '../../ai/lib/providerStore';
import { extractMemoriesFromTurn } from '../../memory/lib/memoryExtractor';
import { localMemoryEngine } from '../../memory/lib/memoryRepository';
import { cancelActivePhoneAutomation } from '../../phoneControl/lib/phoneActionSafety';
import { saveLocalCallSession } from '../../schedules/lib/callHistoryRepository';
import { publishAudioLevel, resetAudioLevel } from '../lib/audioLevelStore';
import {
  DirectVoiceHandle,
  startDirectGeminiVoiceSession,
} from '../lib/directGeminiVoice';
import { startDirectOpenAiVoiceSession } from '../lib/directOpenAiVoice';
import { startUniversalVoiceSession } from '../lib/universalBridgeVoice';
import {
  getVoiceSettingsSync,
  subscribeVoiceSettings,
} from '../lib/voiceSettingsStore';

export type CallConnectionState =
  | 'connecting'
  | 'connected'
  | 'agent_speaking'
  | 'disconnected'
  | 'error';

export type AgentVisualizerState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking';

export interface CallChatMessage {
  id: string;
  sender: 'user' | 'kallie';
  text: string;
  timestamp: number;
  isFinal?: boolean;
}

export interface DirectVoiceSessionParams {
  sessionId: string;
  title?: string;
  aiPrompt?: string;
  isScheduledCallback?: boolean;
  enabled: boolean;
  onRemoteEnded?: () => void;
  onMissingProviderKey?: () => void;
}

/**
 * 100% Serverless Direct Voice Session hook.
 * Connects straight from Android to Google Gemini Live, OpenAI Realtime, or Universal Voice
 * using the user's Android Keystore BYOK key — with pre-connect mute sync & live speaker toggle.
 */
export function useDirectVoiceSession(params: DirectVoiceSessionParams) {
  const [status, setStatus] = useState<CallConnectionState>('disconnected');
  const [agentState, setAgentState] = useState<AgentVisualizerState>('idle');
  const [agentReady, setAgentReady] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<AuraConnectionStatus>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<CallChatMessage[]>([]);

  const handleRef = useRef<DirectVoiceHandle | null>(null);
  const isMutedRef = useRef(false);
  const messagesRef = useRef<CallChatMessage[]>([]);
  const persistedSessionRef = useRef<string | null>(null);
  const onRemoteEndedRef = useRef(params.onRemoteEnded);
  onRemoteEndedRef.current = params.onRemoteEnded;
  const onMissingKeyRef = useRef(params.onMissingProviderKey);
  onMissingKeyRef.current = params.onMissingProviderKey;

  messagesRef.current = messages;

  const upsertMessage = useCallback(
    (id: string, sender: 'user' | 'kallie', text: string, isFinal: boolean) => {
      const cleaned = text.trim();
      if (!cleaned) return;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], text: cleaned, isFinal: isFinal || next[idx].isFinal };
          return next;
        }
        return [...prev, { id, sender, text: cleaned, timestamp: Date.now(), isFinal }];
      });
    },
    [],
  );

  const persistSessionTranscript = useCallback(
    (sessionId: string, title: string, aiPrompt: string, startedAtIso: string) => {
      const effectiveId = sessionId || startedAtIso;
      if (persistedSessionRef.current === effectiveId) return;
      const msgs = messagesRef.current;
      if (!msgs.length) return;
      persistedSessionRef.current = effectiveId;
      const transcript: TranscriptEntry[] = msgs.map((m) => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        text: m.text,
        timestamp: new Date(m.timestamp).toISOString(),
      }));
      const nowIso = new Date().toISOString();
      saveLocalCallSession({
        id: sessionId || generateUuidV4(),
        schedule_id: null,
        room_name: 'direct-serverless',
        title,
        ai_prompt: aiPrompt,
        status: 'completed',
        started_at: startedAtIso,
        ended_at: nowIso,
        transcript,
        summary: null,
        created_at: startedAtIso,
        updated_at: nowIso,
      });

      const lastUser = [...msgs].reverse().find((m) => m.sender === 'user')?.text;
      const lastAgent = [...msgs].reverse().find((m) => m.sender === 'kallie')?.text;
      if (lastUser && lastAgent) {
        void extractMemoriesFromTurn(lastUser, lastAgent, sessionId).catch(() => {});
      }
    },
    [],
  );

  // Sync mid-call speakerphone setting changes from Settings live onto the active audio handle
  useEffect(() => {
    if (!params.enabled) return;
    return subscribeVoiceSettings(() => {
      const speakerphone = getVoiceSettingsSync().preferredAudioOutput !== 'earpiece';
      handleRef.current?.setSpeakerphone(speakerphone);
    });
  }, [params.enabled]);

  useEffect(() => {
    if (!params.enabled) {
      handleRef.current?.close();
      handleRef.current = null;
      isMutedRef.current = false;
      setStatus('disconnected');
      setAgentState('idle');
      setAgentReady(false);
      setConnectionStatus('idle');
      resetAudioLevel();
      setIsMuted(false);
      const t = setTimeout(() => setMessages([]), 280);
      return () => clearTimeout(t);
    }

    let cancelled = false;
    const startAbort = new AbortController();
    const startedAtIso = new Date().toISOString();
    const sessionTitle = params.title || 'Voice with Kallie';
    const sessionPrompt = params.aiPrompt || 'Natural voice conversation';
    persistedSessionRef.current = null;

    setStatus('connecting');
    setAgentState('connecting');
    setAgentReady(false);
    setConnectionStatus('connecting');
    setError(null);
    setMessages([]);

    const start = async () => {
      try {
        const allProviders = listAiProvidersSync();
        const active = getActiveAiProviderSync();

        const candidates = [
          ...(active && (active.providerType === 'gemini' || active.providerType === 'openai')
            ? [active]
            : []),
          ...allProviders.filter(
            (p) =>
              (p.providerType === 'gemini' || p.providerType === 'openai') &&
              p.id !== active?.id,
          ),
        ];

        let chosenProvider: (typeof candidates)[number] | null = null;
        let chosenKey: string | null = null;
        for (const p of candidates) {
          const key = await getProviderApiKey(p);
          if (key && key.trim()) {
            chosenProvider = p;
            chosenKey = key.trim();
            break;
          }
        }

        if (cancelled) return;
        const voiceSettings = getVoiceSettingsSync();
        const speakerphone = voiceSettings.preferredAudioOutput !== 'earpiece';
        const memoryContext = localMemoryEngine.buildFastPromptContextSync(
          sessionTitle,
          6,
        );

        const callbacks = {
          onReady: () => {
            if (cancelled) return;
            setAgentReady(true);
            setStatus('connected');
            setConnectionStatus('connected');
          },
          onAgentState: (next: 'connecting' | 'listening' | 'thinking' | 'speaking') => {
            if (cancelled) return;
            setAgentState(next);
            setStatus(next === 'speaking' ? 'agent_speaking' : 'connected');
          },
          onTranscriptDelta: (
            id: string,
            sender: 'user' | 'kallie',
            text: string,
            isFinal: boolean,
          ) => {
            if (!cancelled) {
              upsertMessage(id, sender, text, isFinal);
            }
          },
          onAudioLevel: (level: number) => {
            if (!cancelled) publishAudioLevel(level);
          },
          onEnded: () => {
            if (cancelled) return;
            persistSessionTranscript(params.sessionId, sessionTitle, sessionPrompt, startedAtIso);
            onRemoteEndedRef.current?.();
          },
          onError: (msg: string) => {
            if (cancelled) return;
            setError(msg);
            setStatus('error');
            setConnectionStatus('disconnected');
            onRemoteEndedRef.current?.();
          },
        };

        if (!chosenProvider || !chosenKey) {
          if (active) {
            const fallbackHandle = await startUniversalVoiceSession({
              providerLabel: active.displayName || 'AI',
              title: sessionTitle,
              aiPrompt: sessionPrompt,
              memoryContext,
              isScheduledCallback: params.isScheduledCallback,
              speakerphone,
              callbacks,
            });
            if (cancelled) {
              fallbackHandle.close();
              return;
            }
            handleRef.current = fallbackHandle;
            if (isMutedRef.current) {
              fallbackHandle.setMuted(true);
            }
            return;
          }

          setStatus('disconnected');
          setAgentState('idle');
          setConnectionStatus('idle');
          setError('Connect an AI provider or pair your PC in Settings to talk.');
          onMissingKeyRef.current?.();
          return;
        }

        const handle =
          chosenProvider.providerType === 'openai'
            ? await startDirectOpenAiVoiceSession({
                apiKey: chosenKey,
                voiceName: voiceSettings.voiceName,
                title: sessionTitle,
                aiPrompt: sessionPrompt,
                memoryContext,
                isScheduledCallback: params.isScheduledCallback,
                speakerphone,
                signal: startAbort.signal,
                callbacks,
              })
            : await startDirectGeminiVoiceSession({
                apiKey: chosenKey,
                voiceName: voiceSettings.voiceName,
                title: sessionTitle,
                aiPrompt: sessionPrompt,
                memoryContext,
                isScheduledCallback: params.isScheduledCallback,
                speakerphone,
                signal: startAbort.signal,
                callbacks,
              });

        if (cancelled) {
          handle.close();
          return;
        }
        handleRef.current = handle;
        // Replay pre-connect mute state so UI & native audio capture can never desync
        if (isMutedRef.current) {
          handle.setMuted(true);
        }
      } catch (err) {
        if (cancelled) return;
        setError(formatSafeError(err, 'Unable to start direct voice'));
        setStatus('error');
        setConnectionStatus('disconnected');
        onRemoteEndedRef.current?.();
      }
    };

    void start();

    return () => {
      cancelled = true;
      startAbort.abort();
      cancelActivePhoneAutomation('internal');
      persistSessionTranscript(params.sessionId, sessionTitle, sessionPrompt, startedAtIso);
      handleRef.current?.close();
      handleRef.current = null;
      resetAudioLevel();
    };
  }, [
    params.aiPrompt,
    params.enabled,
    params.isScheduledCallback,
    params.sessionId,
    params.title,
    persistSessionTranscript,
    upsertMessage,
  ]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !handleRef.current) return;
      upsertMessage(`typed_${Date.now()}`, 'user', trimmed, true);
      setAgentState('thinking');
      handleRef.current.sendText(trimmed);
    },
    [upsertMessage],
  );

  const toggleMute = useCallback(async () => {
    const next = !isMutedRef.current;
    isMutedRef.current = next;
    setIsMuted(next);
    handleRef.current?.setMuted(next);
  }, []);

  const endCall = useCallback(async () => {
    cancelActivePhoneAutomation('internal');
    handleRef.current?.close();
    handleRef.current = null;
    isMutedRef.current = false;
    resetAudioLevel();
    setIsMuted(false);
    setStatus('disconnected');
    setAgentState('idle');
    setAgentReady(false);
    setConnectionStatus('idle');
  }, []);

  return {
    status,
    agentState,
    agentReady,
    connectionStatus,
    isMuted,
    error,
    messages,
    sendMessage,
    toggleMute,
    endCall,
  };
}
