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
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [agentJoined, setAgentJoined] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

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

    room.on(RoomEvent.ParticipantConnected, () => {
      if (!cancelled) {
        setAgentJoined(true);
      }
    });

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      if (cancelled) return;
      const remoteSpeaker = speakers.find(
        (speaker) => speaker.identity !== room.localParticipant.identity,
      );
      if (remoteSpeaker) {
        setStatus('agent_speaking');
        setAudioLevel(Math.max(0.35, Math.min(1, remoteSpeaker.audioLevel || 0.65)));
      } else if (wasConnectedRef.current) {
        setStatus('connected');
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
      audioElementsRef.current.forEach((el) => el.remove());
      audioElementsRef.current = [];
      void room.disconnect().catch(() => {});
      roomRef.current = null;
      if (nativeLk) {
        void nativeLk.AudioSession.stopAudioSession().catch(() => {});
      }
    };
  }, [params.livekitUrl, params.sessionId, params.token]);

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
    error,
    isMuted,
    isSpeakerOn,
    agentJoined,
    audioLevel,
    elapsedSeconds,
    toggleMute,
    toggleSpeaker,
    endCall,
  };
}
