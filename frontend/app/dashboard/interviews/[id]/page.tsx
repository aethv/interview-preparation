'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Play,
  CheckCircle2,
  Loader2,
  Mic,
  ArrowLeft,
  Volume2,
  RefreshCw,
  AlertCircle,
  PauseCircle,
} from 'lucide-react';
import { interviewsApi, Interview } from '@/lib/api/interviews';
import { voiceApi } from '@/lib/api/voice';
import { useAuthStore } from '@/lib/store/auth-store';
import { useSessionStore } from '@/lib/store/session-store';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import Link from 'next/link';
import { CodeSandbox } from '@/components/interview/sandbox';
import { EnglishSessionPanel } from '@/components/interview/english-session-panel';
import { ConversationHistory } from '@/components/interview/conversation-history';
import { SessionTypeBadge } from '@/components/interview/session-type-badge';
import { formatCost } from '@/lib/format-cost';
import { MicLevelMeter } from '@/components/interview/mic-level-meter';
import { showCodeEditor } from '@/lib/interview-session';
import { getCameraPreference } from '@/lib/media-preferences';
import { useLiveKitRoom } from '@/hooks/use-livekit-room';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InterviewSkillCard } from '@/components/analytics/interview-skill-card';
import { EnglishFeedbackCard, getEnglishBreakdown } from '@/components/analytics/english-feedback-card';

// Dynamically import components to avoid SSR issues
const AvatarWithWaves = dynamic(
  () => import('@/components/interview/avatar-with-waves').then((mod) => ({ default: mod.AvatarWithWaves })),
  { ssr: false }
);

const ParticipantVideo = dynamic(
  () => import('@/components/interview/participant-video').then((mod) => ({ default: mod.ParticipantVideo })),
  { ssr: false }
);

const TranscriptionDisplay = dynamic(
  () => import('@/components/interview/transcription-display').then((mod) => ({ default: mod.TranscriptionDisplay })),
  { ssr: false }
);

const RoomControls = dynamic(
  () => import('@/components/interview/room-controls').then((mod) => ({ default: mod.RoomControls })),
  { ssr: false }
);

export default function InterviewDetailPage() {
  const params = useParams();
  const interviewId = parseInt(params.id as string);
  const [isStarting, setIsStarting] = useState(false);
  const [voiceToken, setVoiceToken] = useState<{ token: string; url: string } | null>(null);
  const [showVoiceVideo, setShowVoiceVideo] = useState(false);
  const [agentReady, setAgentReady] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const startSession = useSessionStore((st) => st.startSession);
  const endSession = useSessionStore((st) => st.endSession);

  // Use the custom LiveKit hook - handles all connection lifecycle
  const {
    room: roomInstance,
    state: roomState,
    isConnected,
    isConnecting,
    reconnect: reconnectRoom,
    disconnect: disconnectRoom,
    error: roomError,
  } = useLiveKitRoom({
    token: voiceToken?.token || null,
    url: voiceToken?.url || null,
    onConnected: async (room) => {
      // Reset agent ready state when connecting to new room
      setAgentReady(false);

      // Agent is ready as soon as any remote participant joins the room
      const markAgentReady = () => {
        setAgentReady(true);
        console.log('✅ Agent joined room');
      };

      // Check if agent is already in the room
      if (room.remoteParticipants.size > 0) {
        markAgentReady();
      } else {
        room.once('participantConnected', markAgentReady);
      }

      console.log('Room connected, enabling tracks...');
      // Wait for engine to be ready
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Sessions are audio-only unless the user has previously turned the camera
      // on. The agent only subscribes to audio, so publishing video by default
      // burns bandwidth and LiveKit minutes for nothing.
      const wantsCamera = getCameraPreference();

      if (wantsCamera) {
        try {
          const permissionStatus = await navigator.permissions.query({
            name: 'camera' as PermissionName
          });
          console.log('Camera permission status:', permissionStatus.state);
          if (permissionStatus.state === 'denied') {
            console.warn('⚠️ Camera permission denied - video may not work');
            toast.warning('Camera permission denied. Please allow camera access in browser settings.');
          }
        } catch (error) {
          // Permissions API not supported or camera permission not queryable
          console.log('Could not query camera permission:', error);
        }
      }

      // Enable tracks with retry
      const enableTrackWithRetry = async (
        enableFn: () => Promise<unknown>,
        trackName: string,
        maxRetries = 3
      ) => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            await enableFn();
            console.log(`${trackName} enabled successfully`);
            return true;
          } catch (error: unknown) {
            console.warn(`${trackName} enable attempt ${attempt} failed:`, error);
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, attempt - 1)));
            }
          }
        }
        return false;
      };

      // Enable microphone
      enableTrackWithRetry(
        () => room.localParticipant.setMicrophoneEnabled(true),
        'Microphone'
      ).catch(() => {});

      if (!wantsCamera) {
        console.log('Audio-only session (camera off by default)');
        return;
      }

      // Wait before enabling camera
      await new Promise(resolve => setTimeout(resolve, 500));

      // Enable camera (async - must await the promise)
      const cameraEnabled = await enableTrackWithRetry(
        () => room.localParticipant.setCameraEnabled(true),
        'Camera'
      );

      if (!cameraEnabled) {
        console.error('Failed to enable camera after retries');
        toast.error('Failed to enable camera. Please check browser permissions.');
      }
    },
    onDisconnected: (reason) => {
      console.warn('Room disconnected:', reason);
      toast.warning('Room disconnected. Click reconnect to continue.');
    },
    onError: (error) => {
      console.error('Room connection error:', error);
      toast.error(`Connection failed: ${error.message}`);
    },
  });

  // Fetch interview
  const { data: interview, isLoading } = useQuery<Interview>({
    queryKey: ['interview', interviewId],
    queryFn: () => interviewsApi.get(interviewId),
    enabled: !!interviewId,
    refetchInterval: (query) => {
      return query.state.data?.status === 'in_progress' ? 2000 : false;
    },
  });

  const canRespond = interview?.status === 'in_progress';
  const isCompleted = interview?.status === 'completed';
  const hasCodeEditor = interview
    ? showCodeEditor(interview.job_description, interview.title, interview.session_mode)
    : true;

  // Fetch skill breakdown for completed interviews
  // English sessions return language scores under their own keys, not the four
  // interview skills, so they render a different card.
  const { data: skillBreakdown, isLoading: skillBreakdownLoading } = useQuery({
    queryKey: ['interview-skills', interviewId],
    queryFn: () => interviewsApi.getInterviewSkills(interviewId),
    enabled: isCompleted && !!interviewId,
  });

  const englishBreakdown = getEnglishBreakdown(skillBreakdown);

  // If the agent has not joined shortly after we connect, something is wrong
  // server-side (usually a rejected API key). Ask the backend why, so the user
  // gets a reason instead of an endless "preparing" spinner.
  // A session is "live" once we are connected to the room; while it is, the
  // navbar locks and leaving is blocked so the room is never stranded.
  const sessionLive = canRespond && (isConnected || isConnecting);

  useEffect(() => {
    if (sessionLive) {
      startSession(interviewId);
    } else {
      endSession();
    }
  }, [sessionLive, interviewId, startSession, endSession]);

  // Always release the lock if this page unmounts for any reason
  useEffect(() => () => endSession(), [endSession]);

  // Native guard for tab close / reload, which React cannot intercept
  useEffect(() => {
    if (!sessionLive) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [sessionLive]);

  const agentStalled = isConnected && !agentReady;
  const { data: voiceHealth } = useQuery({
    queryKey: ['voice-health'],
    queryFn: () => voiceApi.health(),
    enabled: agentStalled,
    refetchInterval: 15000,
    retry: false,
  });
  // "Interviewer" is wrong for a language practice session
  const agentLabel = hasCodeEditor ? 'Interviewer' : 'Partner';

  // Get voice token mutation
  const voiceTokenMutation = useMutation({
    mutationFn: async () => {
      const roomName = `interview-${interviewId}`;
      const response = await voiceApi.getToken({
        room_name: roomName,
        participant_name: user?.full_name || 'User',
        participant_identity: user?.id.toString() || '',
        can_publish: true,
        can_subscribe: true,
      });
      return response;
    },
    onSuccess: (data) => {
      setVoiceToken({ token: data.token, url: data.url });
      setShowVoiceVideo(true);
      toast.success('Voice token obtained. Connecting to room...');
    },
    onError: (error: any) => {
      console.error('Failed to get voice token:', error);
    },
  });

  // Start interview mutation
  const startMutation = useMutation({
    mutationFn: async () => {
      const data = await interviewsApi.start(interviewId);
      try {
        await voiceTokenMutation.mutateAsync();
      } catch (error) {
        console.warn('Voice token failed, continuing with text-only interview');
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['interview', interviewId], data);
      setIsStarting(false);
      toast.success('Interview started!');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to start interview');
      setIsStarting(false);
    },
  });

  // Complete mutation
  const completeMutation = useMutation({
    mutationFn: () => interviewsApi.complete(interviewId),
    onSuccess: (data) => {
      queryClient.setQueryData(['interview', interviewId], data);
      // Release the room and the navigation lock; otherwise the agent stays in
      // the room and the navbar remains locked after the session has ended.
      disconnectRoom();
      setVoiceToken(null);
      setShowVoiceVideo(false);
      setAgentReady(false);
      endSession();
      toast.success('Interview completed!');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to complete interview');
    },
  });

  const handleStart = () => {
    setIsStarting(true);
    startMutation.mutate();
  };

  /** Leave the room but keep the interview in progress so it can be resumed. */
  const handlePause = () => {
    disconnectRoom();
    setVoiceToken(null);
    setShowVoiceVideo(false);
    setAgentReady(false);
    endSession();
    // Stop the polling queries that belong to a live session
    queryClient.cancelQueries({ queryKey: ['session-state', interviewId] });
    toast.success('Session paused. Rejoin any time to continue.');
  };

  const handleComplete = () => {
    if (confirm('Are you sure you want to complete this interview?')) {
      completeMutation.mutate();
    }
  };

  // Audio test function - triggers interviewer to speak
  const testAudio = async () => {
    console.log('testAudio called', { roomInstance: !!roomInstance, state: roomState, isConnected });
    
    try {
      if (!roomInstance || !isConnected) {
        toast.error('Not connected to room yet. Please wait for connection.');
        return;
      }

      // Request microphone permission first (browser requirement)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop()); // Stop immediately, we just needed permission

      // Send test audio request to interviewer via data channel
      const testMessage = JSON.stringify({ type: 'test_audio' });
      await roomInstance.localParticipant.publishData(
        new TextEncoder().encode(testMessage),
        { reliable: true }
      );

      toast.info('Sent test request to interviewer. Listen for greeting...');
      
      // Check if interviewer audio tracks are available
      let hasAudioTracks = false;
      for (const participant of roomInstance.remoteParticipants.values()) {
        const audioPublications = Array.from(participant.trackPublications.values()).filter(
          pub => pub.kind === 'audio' && pub.isSubscribed
        );
        if (audioPublications.length > 0) {
          hasAudioTracks = true;
          break;
        }
      }

      if (!hasAudioTracks) {
        toast.warning('Waiting for interviewer audio tracks. The interviewer should speak shortly...');
      }
    } catch (error: any) {
      console.error('Audio test failed:', error);
      toast.error(
        error.name === 'NotAllowedError'
          ? 'Please allow microphone access to test audio'
          : `Audio test failed: ${error.message}`
      );
    }
  };

  if (isLoading) {
    return (
      <div className="h-screen flex flex-col">
        <Skeleton className="h-16 w-full" />
        <div className="flex-1 flex">
          <Skeleton className="w-96 h-full" />
          <Skeleton className="flex-1 h-full" />
        </div>
      </div>
    );
  }

  if (!interview) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Interview not found</p>
            <Button asChild className="mt-4" variant="outline">
              <Link href="/dashboard/interviews">Back to Interviews</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Top Navigation Bar with Buttons */}
      <div className="border-b border-border bg-background px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          {sessionLive ? (
            <Button
              variant="ghost" size="sm" disabled
              title="Pause or complete the session first"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          ) : (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard/interviews">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Link>
            </Button>
          )}
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-lg font-semibold truncate">{interview.title}</h1>
            <SessionTypeBadge session={interview} />
            {(interview.llm_cost_usd ?? 0) > 0 && (
              <span
                className="text-xs text-muted-foreground whitespace-nowrap"
                title={`${interview.llm_calls ?? 0} calls · ${(interview.llm_total_tokens ?? 0).toLocaleString()} tokens · approximate, chat only`}
              >
                ~{formatCost(interview.llm_cost_usd)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {interview.status === 'pending' && (
            <Button
              onClick={handleStart}
              disabled={isStarting || startMutation.isPending}
            >
              {isStarting || startMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Start Interview
                </>
              )}
            </Button>
          )}
          {canRespond && !showVoiceVideo && (
            <Button
              variant="outline"
              onClick={() => voiceTokenMutation.mutate()}
              disabled={voiceTokenMutation.isPending}
            >
              {voiceTokenMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Mic className="mr-2 h-4 w-4" />
                  Join Session
                </>
              )}
            </Button>
          )}
          {canRespond && showVoiceVideo && (
            <>
              {isConnecting && (
                <Button variant="outline" disabled>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </Button>
              )}
              {roomState === 'disconnected' && (
                <Button
                  variant="default"
                  onClick={reconnectRoom}
                  title="Reconnect to room"
                  disabled={isConnecting}
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Reconnecting...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Reconnect
                    </>
                  )}
                </Button>
              )}
              {isConnected && roomInstance && (
                <Button
                  variant="outline"
                  onClick={testAudio}
                  title="Test audio playback"
                >
                  <Volume2 className="mr-2 h-4 w-4" />
                  Test Audio
                </Button>
              )}
            </>
          )}
          {sessionLive && (
            <Button variant="outline" onClick={handlePause} title="Leave the room, keep the session">
              <PauseCircle className="mr-2 h-4 w-4" />
              Pause
            </Button>
          )}
          {canRespond && (
            <Button
              variant="outline"
              onClick={handleComplete}
              disabled={completeMutation.isPending}
            >
              {completeMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Completing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Complete
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Disconnect Banner - Always visible at top when disconnected */}
      {showVoiceVideo && roomState === 'disconnected' && (
        <div className="bg-destructive text-white px-4 py-3 flex items-center justify-between border-b border-destructive/20 shadow-lg">
          <div className="flex items-center space-x-3">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold text-sm">Room Disconnected</p>
              <p className="text-xs text-destructive-foreground/80">
                Your connection to the interview room has been lost. Click reconnect to continue.
              </p>
            </div>
          </div>
          <Button 
            size="sm" 
            variant="secondary"
            className="bg-white text-destructive hover:bg-white/90 font-semibold"
            onClick={reconnectRoom}
            disabled={isConnecting}
          >
            {isConnecting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Reconnecting...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Reconnect Now
              </>
            )}
          </Button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0">
        {isCompleted ? (
          <Tabs defaultValue="skills" className="flex-1 flex flex-col min-h-0 w-full">
            <div className="border-b border-border px-4 pt-4">
              <TabsList>
                <TabsTrigger value="skills">
                  {englishBreakdown ? 'Feedback' : 'Skill Breakdown'}
                </TabsTrigger>
                <TabsTrigger value="transcript">Transcript</TabsTrigger>
              </TabsList>
            </div>
            
            <TabsContent value="skills" className="flex-1 overflow-y-auto p-4 mt-0">
              {skillBreakdownLoading ? (
                <div className="space-y-4">
                  <Card>
                    <CardContent className="p-6">
                      <Skeleton className="h-64 w-full" />
                    </CardContent>
                  </Card>
                </div>
              ) : englishBreakdown ? (
                <EnglishFeedbackCard breakdown={englishBreakdown} />
              ) : skillBreakdown ? (
                <InterviewSkillCard breakdown={skillBreakdown} />
              ) : (
                <Card>
                  <CardContent className="p-12 text-center">
                    <p className="text-muted-foreground">
                      Skill breakdown not available yet. The analysis may still be processing.
                    </p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
            
            <TabsContent value="transcript" className="flex-1 overflow-y-auto p-4 mt-0">
              <div className="h-full">
                <ConversationHistory
                  messages={interview.conversation_history}
                  agentLabel={agentLabel}
                  title="Interview Transcript"
                  emptyText="No transcript available."
                />
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <>
            {/* Video + conversation (full width for English practice) */}
            <div
              className={
                hasCodeEditor
                  ? 'w-1/3 border-r border-border flex flex-col'
                  : 'flex-1 min-w-0 flex flex-col'
              }
            >
              {/* Connection Status Banner */}
              {showVoiceVideo && roomState === 'disconnected' && (
                <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <AlertCircle className="h-5 w-5 text-destructive" />
                    <span className="text-sm font-medium text-destructive">Room disconnected. Click reconnect to continue.</span>
                  </div>
                  <Button 
                    size="sm" 
                    variant="default"
                    className="bg-destructive hover:bg-destructive/90 text-white"
                    onClick={reconnectRoom}
                    disabled={isConnecting}
                  >
                    {isConnecting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Reconnecting...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Reconnect
                      </>
                    )}
                  </Button>
                </div>
              )}
              {showVoiceVideo && isConnecting && (
                <div className="bg-blue-500/10 border-b border-blue-500/20 px-4 py-2 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    <span className="text-sm text-blue-600">Connecting to room...</span>
                  </div>
                </div>
              )}
              {/* Show "Interviewer is preparing" when connected but agent not ready yet */}
              {showVoiceVideo && isConnected && roomInstance && !agentReady && (
                voiceHealth && !voiceHealth.ok ? (
                  <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-destructive">
                          {agentLabel} cannot start
                        </p>
                        {voiceHealth.problems.map((problem) => (
                          <p key={problem} className="text-xs text-destructive/90">{problem}</p>
                        ))}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          An admin can fix this under Admin → Agent Config → API Keys.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
                      <span className="text-sm text-amber-700">{agentLabel} is preparing... Please wait a moment.</span>
                    </div>
                  </div>
                )
              )}
              
              {canRespond && showVoiceVideo && voiceToken ? (
            <>
              {/* Top Row: Participant Video | Interviewer Avatar side by side.
                  flex-none + overflow-hidden keeps the tiles inside their 16rem
                  band instead of overlapping the transcript underneath. */}
              <div className="flex-none h-64 p-4 grid grid-cols-2 gap-4 overflow-hidden">
                {/* Left Column: Participant Video */}
                <ParticipantVideo 
                  room={roomInstance} 
                  userName={user?.full_name || 'You'}
                />
                
                {/* Right Column: Interviewer Avatar with Waves */}
                <AvatarWithWaves room={roomInstance} />
              </div>
              
              {/* Room Controls (Mute/Video) - Only show when connected */}
              {isConnected && (
                <div className="px-4 pb-2 flex flex-col items-center gap-1">
                  <RoomControls room={roomInstance} />
                  <MicLevelMeter room={roomInstance} />
                </div>
              )}
              
              {/* Bottom: stored transcript (survives rejoin) + live captions */}
              <div className="flex-1 min-h-0 p-4 pt-0 flex flex-col gap-3">
                <div className="flex-1 min-h-0">
                  <ConversationHistory
                    messages={interview.conversation_history}
                    agentLabel={agentLabel}
                    autoScroll
                    emptyText="The conversation will appear here as you talk."
                  />
                </div>
                <div className="flex-none max-h-40 overflow-y-auto">
                  <TranscriptionDisplay room={roomInstance} agentLabel={agentLabel} />
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col p-4 space-y-4">
              {/* Placeholder state */}
              <div className="h-64 grid grid-cols-2 gap-4">
                <Card className="flex items-center justify-center">
                  <CardContent className="text-center">
                    <p className="text-sm font-medium mb-2">Your Video</p>
                    <p className="text-xs text-muted-foreground">
                      {canRespond ? 'Join the session to start (audio only)' : 'Start interview to begin'}
                    </p>
                  </CardContent>
                </Card>
                    <Card className="flex items-center justify-center bg-primary/5">
                      <CardContent className="text-center">
                        <p className="text-sm font-medium mb-2">{agentLabel}</p>
                        <p className="text-xs text-muted-foreground">Will appear when connected</p>
                      </CardContent>
                    </Card>
              </div>
              
              {canRespond && !showVoiceVideo && (
                <div className="flex justify-center">
                  <Button
                    onClick={() => voiceTokenMutation.mutate()}
                    disabled={voiceTokenMutation.isPending}
                  >
                    {voiceTokenMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <Mic className="mr-2 h-4 w-4" />
                        Join Session
                      </>
                    )}
                  </Button>
                </div>
              )}
              
              {/* Rejoining a paused session must show what was already said,
                  which live LiveKit transcription cannot do. */}
              <div className="flex-1 min-h-0">
                <ConversationHistory
                  messages={interview.conversation_history}
                  agentLabel={agentLabel}
                  emptyText={
                    canRespond
                      ? 'Join the session to start talking.'
                      : 'Start the interview to begin.'
                  }
                />
              </div>
            </div>
              )}
            </div>

            {/* English practice gets the coaching panel where the sandbox would be */}
            {!hasCodeEditor && (
              <div className="w-1/3 min-w-72 border-l border-border">
                <EnglishSessionPanel
                  interviewId={interviewId}
                  isActive={canRespond && isConnected}
                />
              </div>
            )}

            {hasCodeEditor && (
              <div className="w-2/3 min-w-0 p-4">
                {canRespond ? (
                  <CodeSandbox interviewId={interviewId} />
                ) : (
                  <div className="h-full flex items-center justify-center">
                    <Card>
                      <CardContent className="py-12 text-center">
                        <p className="text-muted-foreground">
                          Start the interview to access the code editor
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
