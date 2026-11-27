import {
  ConnectionQuality,
  ConnectionState,
  createLocalAudioTrack,
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { AuraConnectionStatus } from '../../../components/auraTheme';
import { apiClient } from '../../../lib/apiClient';
import { clearPendingCallConnection } from '../../../lib/callSessionStore';
import {
  ensureMicrophonePermission,
  getCachedRegionalLiveKitUrl,
  getNativeLiveKit,
  invalidateCachedRegionalLiveKitUrl,
  registerLiveKitGlobals,
  resolveOptimalLiveKitUrl,
  sendStandbyStartSignal,
  StagedStandbySession,
  stopAudioSessionSafe,
  takePrewarmedRoom,
  warmAudioSessionEarly,
} from '../lib/callPrewarm';

export { registerLiveKitGlobals };

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
  isFinal?: boolean;
}

export function useLiveKitCall(params: {
  sessionId: string;
  livekitUrl: string;
  token: string;
  enabled?: boolean;
  callStartedAtMs?: number;
  preconnectedStandby?: StagedStandbySession | null;
  onRemoteEnded?: () => void;
}) {
  const isEnabled = params.enabled !== false;
  const [status, setStatus] = useState<CallConnectionState>(
    isEnabled ? 'connecting' : 'disconnected',
  );
  const [agentState, setAgentState] = useState<AgentVisualizerState>(
    isEnabled ? 'connecting' : 'idle',
  );
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isScreenShareOn, setIsScreenShareOn] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [agentJoined, setAgentJoined] = useState(false);
  const [agentReady, setAgentReady] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<AuraConnectionStatus>(
    isEnabled ? 'connecting' : 'idle',
  );
  const [audioLevel, setAudioLevel] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [messages, setMessages] = useState<CallChatMessage[]>([]);

  const finalizedSegmentsRef = useRef<Set<string>>(new Set());

  const upsertMessage = useCallback(
    (
      id: string,
      sender: 'user' | 'kallie',
      text: string,
      timestamp = Date.now(),
      isFinal = false,
    ) => {
      const cleaned = text.trim();
      if (!cleaned) return;

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === id);
        if (idx >= 0) {
          // Don't let an out-of-order interim chunk overwrite an already-finalized segment
          if (finalizedSegmentsRef.current.has(id) && !isFinal) {
            return prev;
          }
          if (isFinal) {
            finalizedSegmentsRef.current.add(id);
          }
          if (prev[idx].text === cleaned && prev[idx].isFinal === (isFinal || prev[idx].isFinal)) {
            return prev;
          }
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            text: cleaned,
            isFinal: isFinal || next[idx].isFinal,
          };
          return next;
        }

        // Deduplicate if the exact same message from the same sender arrived
        // via another channel (e.g., typed lk.chat echoed back by server) within 5s
        const normalizedNew = cleaned.toLowerCase();
        const recentDupIdx = prev.findIndex(
          (m) =>
            m.sender === sender &&
            m.text.toLowerCase() === normalizedNew &&
            Math.abs(m.timestamp - timestamp) < 5000,
        );
        if (recentDupIdx >= 0) {
          if (isFinal) {
            finalizedSegmentsRef.current.add(id);
          }
          return prev;
        }

        if (isFinal) {
          finalizedSegmentsRef.current.add(id);
        }

        const next = [...prev, { id, sender, text: cleaned, timestamp, isFinal }];
        // Keep transcript chronologically ordered so user speech always precedes the reply it triggered
        next.sort((a, b) => a.timestamp - b.timestamp);
        return next;
      });
    },
    [],
  );

  const roomRef = useRef<Room | null>(null);
  const audioElementsRef = useRef<HTMLMediaElement[]>([]);
  const wasConnectedRef = useRef(false);
  const endedManuallyRef = useRef(false);
  const callStartedAtMsRef = useRef(params.callStartedAtMs);
  callStartedAtMsRef.current = params.callStartedAtMs;
  const preconnectedStandbyRef = useRef(params.preconnectedStandby ?? null);
  preconnectedStandbyRef.current = params.preconnectedStandby ?? null;
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
    if (!isEnabled) {
      setStatus('disconnected');
      setAgentState('idle');
      setError(null);
      setIsMuted(false);
      setIsCameraOn(false);
      setIsScreenShareOn(false);
      setAgentJoined(false);
      setAgentReady(false);
      setConnectionStatus('idle');
      setAudioLevel(0);
      setElapsedSeconds(0);
      // Defer clearing messages until the 260ms exit fade-out finishes so transcript
      // fades out smoothly instead of vanishing abruptly on frame 0
      const clearTimer = setTimeout(() => {
        finalizedSegmentsRef.current.clear();
        setMessages([]);
      }, 300);
      return () => clearTimeout(clearTimer);
    }

    if (!params.livekitUrl || !params.token) {
      setStatus('connecting');
      setAgentState('connecting');
      setConnectionStatus('connecting');
      setError(null);
      return;
    }

    let cancelled = false;
    let preCapturedMicTrack: LocalAudioTrack | null = null;
    let loggedFirstSpeaking = false;
    let loggedTrackSubscribed = false;
    const perfOrigin = callStartedAtMsRef.current ?? Date.now();
    const elapsedMs = () => Date.now() - perfOrigin;

    wasConnectedRef.current = false;
    endedManuallyRef.current = false;
    finalizedSegmentsRef.current.clear();
    setMessages([]);
    setStatus('connecting');
    setAgentState('connecting');
    setConnectionStatus('connecting');
    setError(null);

    const adoptedStandby =
      preconnectedStandbyRef.current &&
      preconnectedStandbyRef.current.joinData.session.id === params.sessionId
        ? preconnectedStandbyRef.current
        : null;

    const room = adoptedStandby ? adoptedStandby.room : takePrewarmedRoom();
    roomRef.current = room;

    const markConnectedIfStable = () => {
      setConnectionStatus((prev) =>
        prev === 'weak' || prev === 'disconnected' ? prev : 'connected',
      );
    };

    const syncAgentAttrState = (attrs?: Record<string, string>) => {
      const parsed = parseAgentState(attrs?.['lk.agent.state']);
      if (parsed && !cancelled) {
        setAgentState(parsed);
        if (parsed === 'listening' || parsed === 'thinking' || parsed === 'speaking') {
          setAgentReady(true);
          markConnectedIfStable();
        }
        if (parsed === 'speaking') {
          if (!loggedFirstSpeaking) {
            loggedFirstSpeaking = true;
            console.log(
              `[CallPerf] firstAgentSpeaking(attr)=${elapsedMs()}ms session=${params.sessionId}`,
            );
          }
          setStatus('agent_speaking');
        } else if (wasConnectedRef.current) {
          setStatus('connected');
        }
      }
    };

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (!cancelled) {
        console.log(
          `[CallPerf] agentJoined=${elapsedMs()}ms identity=${participant.identity} session=${params.sessionId}`,
        );
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
        if (!loggedFirstSpeaking) {
          loggedFirstSpeaking = true;
          console.log(
            `[CallPerf] firstAgentSpeaking(audio)=${elapsedMs()}ms session=${params.sessionId}`,
          );
        }
        setAgentReady(true);
        markConnectedIfStable();
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
        if (track.kind === Track.Kind.Audio) {
          if (!loggedTrackSubscribed) {
            loggedTrackSubscribed = true;
            console.log(
              `[CallPerf] agentAudioSubscribed=${elapsedMs()}ms session=${params.sessionId}`,
            );
          }
          setAgentReady(true);
          markConnectedIfStable();
        }
      }
    });

    room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      if (cancelled) return;
      if (participant.identity !== room.localParticipant.identity) return;
      if (quality === ConnectionQuality.Lost) {
        setConnectionStatus('disconnected');
      } else if (quality === ConnectionQuality.Poor) {
        setConnectionStatus('weak');
      } else if (
        (quality === ConnectionQuality.Good || quality === ConnectionQuality.Excellent) &&
        wasConnectedRef.current
      ) {
        setConnectionStatus('connected');
      }
    });

    room.on(RoomEvent.Reconnecting, () => {
      if (!cancelled) {
        setConnectionStatus('weak');
      }
    });

    room.on(RoomEvent.Reconnected, () => {
      if (!cancelled) {
        setConnectionStatus('connected');
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (Platform.OS === 'web') {
        track.detach().forEach((el) => el.remove());
      }
    });

    // Use LiveKit text streams (lk.transcription + lk.chat) as the single authoritative
    // transcript source. Do NOT also subscribe to deprecated RoomEvent.TranscriptionReceived,
    // which emits the exact same segments a second time and causes duplicate messages.
    const handleTextStream = async (
      reader: AsyncIterable<string> & {
        info?: { id?: string; timestamp?: number; attributes?: Record<string, string> };
      },
      participantInfo: { identity: string },
      topic: 'lk.transcription' | 'lk.chat',
    ) => {
      if (cancelled) return;
      const attrs = reader.info?.attributes;
      const transcribedTrackId = attrs?.['lk.transcribed_track_id'];
      const isLocalTrack =
        Boolean(transcribedTrackId) &&
        Array.from(room.localParticipant.audioTrackPublications.values()).some(
          (pub) => pub.trackSid === transcribedTrackId,
        );
      const isLocal =
        participantInfo.identity === room.localParticipant.identity || isLocalTrack;

      // Ignore local lk.chat echoes since sendMessage already inserts typed user messages
      if (topic === 'lk.chat' && isLocal) return;

      const canonicalId =
        attrs?.['lk.segment_id'] ||
        reader.info?.id ||
        `${topic}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const isFinal = attrs?.['lk.transcription_final'] === 'true' || topic === 'lk.chat';
      const ts = reader.info?.timestamp || Date.now();
      const sender: 'user' | 'kallie' = isLocal ? 'user' : 'kallie';

      let accumulated = '';
      try {
        for await (const chunk of reader) {
          if (cancelled) break;
          accumulated += chunk;
          upsertMessage(canonicalId, sender, accumulated, ts, false);
        }
        if (!cancelled && accumulated.trim()) {
          upsertMessage(canonicalId, sender, accumulated, ts, isFinal);
        }
      } catch {
        // Ignore stream close errors on disconnect
      }
    };

    try {
      room.registerTextStreamHandler('lk.transcription', (reader, participantInfo) => {
        void handleTextStream(reader, participantInfo, 'lk.transcription');
      });
      room.registerTextStreamHandler('lk.chat', (reader, participantInfo) => {
        void handleTextStream(reader, participantInfo, 'lk.chat');
      });
    } catch {
      // Safe fallback if handler already registered
    }

    room.on(RoomEvent.Disconnected, () => {
      if (cancelled) return;
      setStatus('disconnected');
      setConnectionStatus(endedManuallyRef.current ? 'idle' : 'disconnected');
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

        // Fast-path activation if we adopted a pre-connected standby room:
        // reuse the imperative t=0ms `start_call` promise if already sent on tap,
        // otherwise send `start_call` immediately so Gemini speaks on its warm WS.
        let connectedViaStandby = false;
        if (adoptedStandby) {
          if (adoptedStandby.startSignalSent && adoptedStandby.startSignalPromise) {
            const ok = await adoptedStandby.startSignalPromise;
            if (ok && room.state === ConnectionState.Connected) {
              connectedViaStandby = true;
            }
          } else {
            const ok =
              adoptedStandby.isConnected() || (await adoptedStandby.connectPromise);
            if (ok && room.state === ConnectionState.Connected) {
              connectedViaStandby = true;
              await sendStandbyStartSignal(room);
              console.log(
                `[CallPerf] standbyActivated=${elapsedMs()}ms session=${params.sessionId}`,
              );
            }
          }
        }

        // Await AudioSession (started at t=0ms on Aura tap)
        await warmAudioSessionEarly();
        console.log(`[CallPerf] audioReady=${elapsedMs()}ms session=${params.sessionId}`);

        // Reuse imperative t=0ms mic capture if available, else capture in parallel with room.connect()
        const micCapturePromise = (
          adoptedStandby?.preCapturedMicPromise ||
          createLocalAudioTrack({
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          })
        )
          .then((track) => {
            if (!track) return null;
            if (cancelled) {
              track.stop();
              return null;
            }
            preCapturedMicTrack = track;
            return track;
          })
          .catch(() => null);

        if (!connectedViaStandby) {
          const targetUrl =
            getCachedRegionalLiveKitUrl(params.livekitUrl) !== params.livekitUrl
              ? getCachedRegionalLiveKitUrl(params.livekitUrl)
              : await resolveOptimalLiveKitUrl(params.livekitUrl, params.token);

          try {
            await room.connect(targetUrl, params.token, {
              autoSubscribe: true,
            });
          } catch (connectErr) {
            if (targetUrl !== params.livekitUrl && !cancelled) {
              invalidateCachedRegionalLiveKitUrl();
              await room.connect(params.livekitUrl, params.token, {
                autoSubscribe: true,
              });
            } else {
              throw connectErr;
            }
          }
          // If the adopted standby session reconnected onto a standby-flagged room,
          // still deliver start_call so the agent activates cleanly.
          if (adoptedStandby && !cancelled) {
            await sendStandbyStartSignal(room).catch(() => {});
          }
        }

        console.log(`[CallPerf] roomConnected=${elapsedMs()}ms session=${params.sessionId}`);
        if (cancelled) {
          const track = await micCapturePromise;
          track?.stop();
          await room.disconnect();
          return;
        }

        wasConnectedRef.current = true;

        if (Platform.OS === 'web') {
          await room.startAudio().catch(() => {});
        }

        // On on-demand fallback calls, if the remote agent is already in the room
        // and actively publishing its audio track, wait briefly (<=300ms) for
        // TrackSubscribed before publishing mic to avoid single-PC SDP renegotiation glare.
        const hasRemoteAudioAlready = Array.from(room.remoteParticipants.values()).some((p) =>
          Array.from(p.audioTrackPublications.values()).some((pub) => pub.isSubscribed),
        );
        if (!connectedViaStandby && room.remoteParticipants.size > 0 && !hasRemoteAudioAlready) {
          await new Promise<void>((resolve) => {
            const onSub = (track: { kind: Track.Kind }) => {
              if (track.kind === Track.Kind.Audio) {
                clearTimeout(timer);
                room.off(RoomEvent.TrackSubscribed, onSub);
                resolve();
              }
            };
            const timer = setTimeout(() => {
              room.off(RoomEvent.TrackSubscribed, onSub);
              resolve();
            }, 300);
            room.on(RoomEvent.TrackSubscribed, onSub);
          });
        }

        const capturedTrack = await micCapturePromise;
        if (cancelled) {
          capturedTrack?.stop();
          await room.disconnect();
          return;
        }

        if (capturedTrack) {
          preCapturedMicTrack = null;
          await room.localParticipant.publishTrack(capturedTrack, {
            source: Track.Source.Microphone,
          });
        } else {
          await room.localParticipant.setMicrophoneEnabled(true, {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          });
        }
        console.log(`[CallPerf] micPublished=${elapsedMs()}ms session=${params.sessionId}`);

        if (!cancelled) {
          const hasRemote = room.remoteParticipants.size > 0;
          setAgentJoined(hasRemote);
          setStatus('connected');
          let alreadyHasAudio = false;
          room.remoteParticipants.forEach((participant) => {
            syncAgentAttrState(participant.attributes);
            participant.audioTrackPublications.forEach((pub) => {
              if (pub.isSubscribed) alreadyHasAudio = true;
            });
          });
          if (alreadyHasAudio) {
            setAgentReady(true);
            markConnectedIfStable();
            setAgentState((prev) => (prev === 'connecting' ? 'listening' : prev));
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to connect to Kallie');
          setStatus('error');
          setConnectionStatus('disconnected');
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (preCapturedMicTrack) {
        preCapturedMicTrack.stop();
        preCapturedMicTrack = null;
      }
      try {
        room.removeAllListeners();
        room.unregisterTextStreamHandler('lk.transcription');
        room.unregisterTextStreamHandler('lk.chat');
      } catch {
        // Ignore unregister errors
      }
      audioElementsRef.current.forEach((el) => el.remove());
      audioElementsRef.current = [];
      roomRef.current = null;
      // Defer heavy native WebRTC/AudioSession teardown slightly past the 260ms GPU
      // exit transition so the UI thread stays locked at 60fps with zero freeze.
      setTimeout(() => {
        void room.disconnect().catch(() => {});
        void stopAudioSessionSafe();
      }, 300);
    };
  }, [isEnabled, params.livekitUrl, params.sessionId, params.token, upsertMessage]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const room = roomRef.current;
      if (!trimmed || !room) return;

      const msgId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      upsertMessage(msgId, 'user', trimmed, Date.now(), true);
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

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const nextCamera = !isCameraOn;
    try {
      if (Platform.OS === 'android' && nextCamera) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          return;
        }
      }
      await room.localParticipant.setCameraEnabled(nextCamera);
      setIsCameraOn(nextCamera);
    } catch {
      setIsCameraOn(false);
    }
  }, [isCameraOn]);

  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const nextShare = !isScreenShareOn;
    try {
      await room.localParticipant.setScreenShareEnabled(nextShare);
      setIsScreenShareOn(nextShare);
    } catch {
      setIsScreenShareOn(false);
    }
  }, [isScreenShareOn]);

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
    roomRef.current = null;
    const sessionId = params.sessionId;

    // Detach listeners & update UI immediately without blocking on native WebRTC/HTTP teardown
    if (room) {
      try {
        room.removeAllListeners();
        room.unregisterTextStreamHandler('lk.transcription');
        room.unregisterTextStreamHandler('lk.chat');
      } catch {
        // Ignore cleanup errors
      }
    }

    setStatus('disconnected');
    setAgentState('idle');
    setAgentReady(false);
    setConnectionStatus('idle');

    // Run native WebRTC disconnect + API cleanup right after the 260ms GPU exit animation
    setTimeout(() => {
      if (room) {
        void room.disconnect().catch(() => {});
      }
      if (sessionId) {
        clearPendingCallConnection(sessionId);
        void apiClient.endCall(sessionId).catch(() => {});
      }
    }, 300);
  }, [params.sessionId]);

  return {
    status,
    agentState,
    error,
    isMuted,
    isCameraOn,
    isScreenShareOn,
    isSpeakerOn,
    agentJoined,
    agentReady,
    connectionStatus,
    audioLevel,
    elapsedSeconds,
    messages,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    toggleSpeaker,
    sendMessage,
    endCall,
  };
}
