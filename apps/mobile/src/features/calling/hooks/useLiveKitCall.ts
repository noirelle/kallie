import { Room, RoomEvent, Track } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { apiClient } from '../../../lib/apiClient';
import { clearPendingCallConnection } from '../../../lib/callSessionStore';

export type CallConnectionState =
  | 'connecting'
  | 'connected'
  | 'agent_speaking'
  | 'disconnected'
  | 'error';

export type AgentVisualizerState =
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking';

function parseAgentState(raw?: string): AgentVisualizerState | null {
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (normalized === 'speaking') return 'speaking';
  if (normalized === 'thinking') return 'thinking';
  if (normalized === 'listening') return 'listening';
  if (normalized === 'initializing' || normalized === 'connecting') return 'connecting';
  return null;
}

export interface CallChatMessage {
  id: string;
  sender: 'user' | 'kallie';
  text: string;
  timestamp: number;
}

type LiveKitNativeModule = {
  registerGlobals: () => void;
  AndroidAudioTypePresets?: {
    communication: Record<string, unknown>;
  };
  AudioSession: {
    startAudioSession: () => Promise<void>;
    stopAudioSession: () => Promise<void>;
    configureAudio?: (options: Record<string, unknown>) => Promise<void>;
    selectAudioOutput?: (output: string) => Promise<void>;
  };
};

let nativeGlobalsRegistered = false;

export function registerLiveKitGlobals(): void {
  if (Platform.OS === 'web' || nativeGlobalsRegistered) {
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@livekit/react-native') as LiveKitNativeModule;
    mod.registerGlobals();
    nativeGlobalsRegistered = true;
  } catch {
    // Safe fallback on web or Expo Go
  }
}

function getNativeLiveKit(): LiveKitNativeModule | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@livekit/react-native') as LiveKitNativeModule;
  } catch {
    return null;
  }
}

async function ensureMicrophonePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  const alreadyGranted = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  );
  if (alreadyGranted) {
    return true;
  }
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'Microphone Permission',
      message: 'Kallie needs microphone access so you can talk during voice calls.',
      buttonPositive: 'Allow',
      buttonNegative: 'Cancel',
    },
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export function useLiveKitCall(params: {
  sessionId: string;
  livekitUrl: string;
  token: string;
  onRemoteEnded?: () => void;
}) {
  const [status, setStatus] = useState<CallConnectionState>('connecting');
  const [agentState, setAgentState] = useState<AgentVisualizerState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [agentJoined, setAgentJoined] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [messages, setMessages] = useState<CallChatMessage[]>([]);

  const upsertMessage = useCallback(
    (id: string, sender: 'user' | 'kallie', text: string, timestamp = Date.now()) => {
      const cleaned = text.trim();
      if (!cleaned) return;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], text: cleaned };
          return next;
        }
        return [...prev, { id, sender, text: cleaned, timestamp }];
      });
    },
    [],
  );

  const roomRef = useRef<Room | null>(null);
  const audioElementsRef = useRef<HTMLMediaElement[]>([]);
  const wasConnectedRef = useRef(false);
  const endedManuallyRef = useRef(false);
  const onRemoteEndedRef = useRef(params.onRemoteEnded);
  onRemoteEndedRef.current = params.onRemoteEnded;

  useEffect(() => {
    if (status !== 'connected' && status !== 'agent_speaking') {
      return;
    }
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (!params.livekitUrl || !params.token) {
      setStatus('error');
      setError('Missing LiveKit connection credentials for this call.');
      return;
    }

    let cancelled = false;
    wasConnectedRef.current = false;
    endedManuallyRef.current = false;

    registerLiveKitGlobals();
    const nativeLk = getNativeLiveKit();

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    roomRef.current = room;

    const syncAgentAttrState = (attrs?: Record<string, string>) => {
      const parsed = parseAgentState(attrs?.['lk.agent.state']);
      if (parsed && !cancelled) {
        setAgentState(parsed);
        if (parsed === 'speaking') {
          setStatus('agent_speaking');
        } else if (wasConnectedRef.current) {
          setStatus('connected');
        }
      }
    };

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (!cancelled) {
        setAgentJoined(true);
        syncAgentAttrState(participant.attributes);
      }
    });

    room.on(RoomEvent.ParticipantAttributesChanged, (_changed, participant) => {
      if (cancelled || participant.identity === room.localParticipant.identity) return;
      syncAgentAttrState(participant.attributes);
    });

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      if (cancelled) return;
      const remoteSpeaker = speakers.find(
        (speaker) => speaker.identity !== room.localParticipant.identity,
      );
      if (remoteSpeaker) {
        setStatus('agent_speaking');
        setAgentState('speaking');
        setAudioLevel(Math.max(0.35, Math.min(1, remoteSpeaker.audioLevel || 0.65)));
      } else if (wasConnectedRef.current) {
        setStatus('connected');
        setAgentState((prev) => (prev === 'thinking' ? 'thinking' : 'listening'));
        setAudioLevel(0.12);
      }
    });

    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio && Platform.OS === 'web') {
        const element = track.attach();
        element.autoplay = true;
        document.body.appendChild(element);
        audioElementsRef.current.push(element);
      }
      if (!cancelled) {
        setAgentJoined(true);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (Platform.OS === 'web') {
        track.detach().forEach((el) => el.remove());
      }
    });

    room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
      if (cancelled) return;
      const isLocal = participant?.identity === room.localParticipant.identity;
      for (const seg of segments) {
        upsertMessage(
          `seg-${seg.id}`,
          isLocal ? 'user' : 'kallie',
          seg.text,
          seg.firstReceivedTime || Date.now(),
        );
      }
    });

    const handleTextStream = async (
      reader: AsyncIterable<string> & {
        info?: { id?: string; timestamp?: number; attributes?: Record<string, string> };
      },
      participantInfo: { identity: string },
    ) => {
      if (cancelled) return;
      const isLocal = participantInfo.identity === room.localParticipant.identity;
      const segId =
        reader.info?.attributes?.['lk.segment_id'] ||
        reader.info?.id ||
        `${Date.now()}-${Math.random()}`;
      const ts = reader.info?.timestamp || Date.now();
      let accumulated = '';
      try {
        for await (const chunk of reader) {
          if (cancelled) break;
          accumulated += chunk;
          upsertMessage(`stream-${segId}`, isLocal ? 'user' : 'kallie', accumulated, ts);
        }
      } catch {
        // Ignore stream close errors on disconnect
      }
    };

    try {
      room.registerTextStreamHandler('lk.transcription', (reader, participantInfo) => {
        void handleTextStream(reader, participantInfo);
      });
      room.registerTextStreamHandler('lk.chat', (reader, participantInfo) => {
        void handleTextStream(reader, participantInfo);
      });
    } catch {
      // Safe fallback if handler already registered
    }

    room.on(RoomEvent.Disconnected, () => {
      if (cancelled) return;
      setStatus('disconnected');
      // Only auto-leave screen if the call actually connected before disconnecting
      if (wasConnectedRef.current && !endedManuallyRef.current) {
        clearPendingCallConnection(params.sessionId);
        onRemoteEndedRef.current?.();
      }
    });

    const connect = async () => {
      try {
        const hasMicPermission = await ensureMicrophonePermission();
        if (!hasMicPermission) {
          throw new Error('Microphone permission is required for voice calls.');
        }

        if (nativeLk) {
          const commPreset = nativeLk.AndroidAudioTypePresets?.communication || {
            manageAudioFocus: true,
            audioMode: 'inCommunication',
            audioFocusMode: 'gain',
            audioAttributesUsageType: 'voiceCommunication',
            audioAttributesContentType: 'speech',
            audioStreamType: 'voiceCall',
          };

          await nativeLk.AudioSession.configureAudio?.({
            android: {
              preferredOutputList: ['bluetooth', 'headset', 'speaker', 'earpiece'],
              audioTypeOptions: commPreset,
            },
            ios: {
              defaultOutput: 'speaker',
            },
          });
          await nativeLk.AudioSession.startAudioSession();
        }

        await room.connect(params.livekitUrl, params.token);
        if (cancelled) {
          await room.disconnect();
          return;
        }

        wasConnectedRef.current = true;

        if (Platform.OS === 'web') {
          await room.startAudio().catch(() => {});
        }
        await room.localParticipant.setMicrophoneEnabled(true);

        if (!cancelled) {
          setAgentJoined(room.remoteParticipants.size > 0);
          setStatus('connected');
          setAgentState('listening');
          room.remoteParticipants.forEach((participant) => {
            syncAgentAttrState(participant.attributes);
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to connect to Kallie');
          setStatus('error');
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      try {
        room.unregisterTextStreamHandler('lk.transcription');
        room.unregisterTextStreamHandler('lk.chat');
      } catch {
        // Ignore unregister errors
      }
      audioElementsRef.current.forEach((el) => el.remove());
      audioElementsRef.current = [];
      void room.disconnect().catch(() => {});
      roomRef.current = null;
      if (nativeLk) {
        void nativeLk.AudioSession.stopAudioSession().catch(() => {});
      }
    };
  }, [params.livekitUrl, params.sessionId, params.token, upsertMessage]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const room = roomRef.current;
      if (!trimmed || !room) return;

      const msgId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      upsertMessage(msgId, 'user', trimmed);
      setAgentState('thinking');
      try {
        await room.localParticipant.sendText(trimmed, { topic: 'lk.chat' });
      } catch {
        setAgentState('listening');
      }
    },
    [upsertMessage],
  );

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const nextMuted = !isMuted;
    await room.localParticipant.setMicrophoneEnabled(!nextMuted);
    setIsMuted(nextMuted);
  }, [isMuted]);

  const toggleSpeaker = useCallback(async () => {
    const nextSpeaker = !isSpeakerOn;
    setIsSpeakerOn(nextSpeaker);
    const nativeLk = getNativeLiveKit();
    if (nativeLk?.AudioSession.selectAudioOutput) {
      await nativeLk.AudioSession.selectAudioOutput(
        nextSpeaker ? 'speaker' : 'earpiece',
      ).catch(() => {});
    }
  }, [isSpeakerOn]);

  const endCall = useCallback(async () => {
    endedManuallyRef.current = true;
    const room = roomRef.current;
    if (room) {
      await room.disconnect().catch(() => {});
    }
    clearPendingCallConnection(params.sessionId);
    await apiClient.endCall(params.sessionId).catch(() => {});
    setStatus('disconnected');
  }, [params.sessionId]);

  return {
    status,
    agentState,
    error,
    isMuted,
    isSpeakerOn,
    agentJoined,
    audioLevel,
    elapsedSeconds,
    messages,
    toggleMute,
    toggleSpeaker,
    sendMessage,
    endCall,
  };
}
