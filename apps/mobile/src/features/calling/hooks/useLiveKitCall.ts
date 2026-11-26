import { Room, RoomEvent, Track } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
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
  AudioSession: {
    startAudioSession: () => Promise<void>;
    stopAudioSession: () => Promise<void>;
    configureAudio?: (options: Record<string, unknown>) => Promise<void>;
  };
};

let nativeGlobalsRegistered = false;

function getNativeLiveKit(): LiveKitNativeModule | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@livekit/react-native') as LiveKitNativeModule;
  } catch {
    return null;
  }
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
  const [agentJoined, setAgentJoined] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const audioElementsRef = useRef<HTMLMediaElement[]>([]);
  const onRemoteEndedRef = useRef(params.onRemoteEnded);
  onRemoteEndedRef.current = params.onRemoteEnded;

  useEffect(() => {
    if (!params.livekitUrl || !params.token) {
      setStatus('error');
      setError('Missing LiveKit connection credentials for this call.');
      return;
    }

    let cancelled = false;
    const nativeLk = getNativeLiveKit();

    if (nativeLk && !nativeGlobalsRegistered) {
      nativeLk.registerGlobals();
      nativeGlobalsRegistered = true;
    }

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
      } else {
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
      if (!cancelled) {
        setStatus('disconnected');
        onRemoteEndedRef.current?.();
      }
    });

    const connect = async () => {
      try {
        if (nativeLk) {
          await nativeLk.AudioSession.configureAudio?.({
            android: {
              preferredOutputList: ['speaker', 'earpiece', 'bluetooth'],
              audioTypeOptions: {
                manageAudioFocus: true,
                audioMode: 'inCommunication',
                audioFocusMode: 'gain',
                audioStreamType: 'voiceCall',
              },
            },
            ios: {
              defaultOutput: 'speaker',
            },
          });
          await nativeLk.AudioSession.startAudioSession();
        }

        await room.connect(params.livekitUrl, params.token);
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
      void room.disconnect();
      roomRef.current = null;
      if (nativeLk) {
        void nativeLk.AudioSession.stopAudioSession().catch(() => {});
      }
    };
  }, [params.livekitUrl, params.token]);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const nextMuted = !isMuted;
    await room.localParticipant.setMicrophoneEnabled(!nextMuted);
    setIsMuted(nextMuted);
  }, [isMuted]);

  const endCall = useCallback(async () => {
    const room = roomRef.current;
    if (room) {
      await room.disconnect();
    }
    clearPendingCallConnection(params.sessionId);
    await apiClient.endCall(params.sessionId).catch(() => {});
    setStatus('disconnected');
  }, [params.sessionId]);

  return {
    status,
    error,
    isMuted,
    agentJoined,
    audioLevel,
    toggleMute,
    endCall,
  };
}
