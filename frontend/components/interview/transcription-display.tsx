'use client';

import { useEffect, useState, useRef, type ReactNode } from 'react';
import { Room, RoomEvent, TranscriptionSegment, ParticipantEvent } from 'livekit-client';
import { Card, CardContent } from '@/components/ui/card';
import { User, UserCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

// Internal marker for "this message came from the agent"; the visible label is a prop.
const AGENT_SPEAKER = 'Interviewer';

interface TranscriptionDisplayProps {
  room: Room | null;
  /** Label for the AI speaker. "Interviewer" is wrong in a practice session. */
  agentLabel?: string;
  /** Extra controls rendered in the header (e.g. minimize/maximize). */
  headerActions?: ReactNode;
  /** When true, only the header row is shown. */
  collapsed?: boolean;
}

interface TranscriptionMessage {
  id: string;
  text: string;
  speaker: string;
  timestamp: Date;
  isFinal: boolean;
}

export function TranscriptionDisplay({
  room,
  agentLabel = 'Interviewer',
  headerActions,
  collapsed = false,
}: TranscriptionDisplayProps) {
  const [messages, setMessages] = useState<TranscriptionMessage[]>([]);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!room) return;

    console.log('Setting up transcription text stream handler for room:', room.name);

    // AgentSession STT outputs are sent via text streams, NOT RoomEvent.TranscriptionReceived
    // We must use registerTextStreamHandler with topic 'lk.transcription'
    const handler = async (reader: any, participantInfo?: any) => {
      try {
        const textData = await reader.readAll();
        const fullText = Array.isArray(textData) ? textData.join('') : textData;
        
        // Check if this is a final transcription
        const isFinal = reader.info?.attributes?.['lk.transcription_final'] === 'true';
        const segmentId = reader.info?.attributes?.['lk.segment_id'];
        const transcribedTrackId = reader.info?.attributes?.['lk.transcribed_track_id'];
        
        console.log('📝 Transcription received:', {
          text: fullText,
          isFinal,
          segmentId,
          participant: participantInfo?.identity || participantInfo?.name || 'Unknown',
          transcribedTrackId,
        });

        // Normalize speaker name - replace agent/AI references with "Interviewer"
        let speakerName = participantInfo?.name || 
                          participantInfo?.identity || 
                          'Unknown';
        
        // Replace agent/AI references with "Interviewer"
        if (speakerName.toLowerCase().includes('agent') || 
            speakerName.toLowerCase().includes('ai') ||
            speakerName.toLowerCase().includes('interviewer')) {
          speakerName = AGENT_SPEAKER;
        }
        
        setMessages((prev) => {
          const newMessages = [...prev];
          
          if (isFinal) {
            // Add final transcription with unique ID
            // Use segmentId + timestamp + speaker + counter to ensure uniqueness
            const uniqueId = `${segmentId || 'final'}-${speakerName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            newMessages.push({
              id: uniqueId,
              text: fullText,
              speaker: speakerName,
              timestamp: new Date(),
              isFinal: true,
            });
          } else {
            // Update or add interim transcription
            const existingIndex = newMessages.findIndex(
              (m) => !m.isFinal && m.speaker === speakerName && segmentId && m.id.startsWith(`${segmentId}-${speakerName}`)
            );
            
            if (existingIndex >= 0) {
              newMessages[existingIndex] = {
                ...newMessages[existingIndex],
                text: fullText,
              };
            } else {
              // Create unique ID for interim messages
              const uniqueId = `${segmentId || 'interim'}-${speakerName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              newMessages.push({
                id: uniqueId,
                text: fullText,
                speaker: speakerName,
                timestamp: new Date(),
                isFinal: false,
              });
            }
          }
          
          // Keep only last 100 messages
          return newMessages.slice(-100);
        });
      } catch (error) {
        console.error('Error reading transcription text stream:', error);
      }
    };

    // Register text stream handler for AgentSession transcriptions
    // Note: registerTextStreamHandler doesn't return a Promise, so no .catch()
    try {
      room.registerTextStreamHandler('lk.transcription', handler);
      console.log('✅ Transcription text stream handler registered for topic: lk.transcription');
    } catch (error) {
      console.error('Failed to register transcription text stream handler:', error);
    }

    return () => {
      try {
        room.unregisterTextStreamHandler('lk.transcription');
      } catch (error) {
        console.warn('Failed to unregister transcription handler:', error);
      }
    };
  }, [room]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <Card className={cn('h-full flex flex-col', collapsed && 'py-0')}>
      <CardContent
        className={cn(
          'flex-1 p-4 flex flex-col min-h-0',
          collapsed && 'py-2.5 justify-center',
        )}
      >
        <div
          className={cn(
            'flex items-center justify-between gap-2 shrink-0',
            !collapsed && 'mb-3',
          )}
        >
          <h3 className="text-sm font-semibold truncate">Conversation</h3>
          {headerActions && (
            <div className="flex items-center gap-1 shrink-0">{headerActions}</div>
          )}
        </div>
        {!collapsed && (
          <div className="flex-1 overflow-y-auto space-y-2 pr-4" ref={scrollAreaRef}>
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Waiting for conversation to start...
              </p>
            ) : (
              messages.map((message) => {
                const isInterviewer = message.speaker === AGENT_SPEAKER ||
                                     message.speaker.toLowerCase().includes('interviewer') ||
                                     message.speaker.toLowerCase().includes('agent') ||
                                     message.speaker.toLowerCase().includes('ai');
                const isUser = message.speaker === room?.localParticipant?.name ||
                             message.speaker === room?.localParticipant?.identity;

                const displayName = isUser ? 'You' : (isInterviewer ? agentLabel : message.speaker);

                return (
                  <div
                    key={message.id}
                    className={`flex items-start gap-2 p-2 rounded-lg ${
                      isInterviewer
                        ? 'bg-primary/5 border-l-2 border-primary'
                        : isUser
                        ? 'bg-muted/50 border-l-2 border-muted-foreground'
                        : 'bg-background'
                    } ${!message.isFinal ? 'opacity-60' : ''}`}
                  >
                    <div className={`flex-shrink-0 mt-0.5 ${
                      isInterviewer ? 'text-primary' : 'text-muted-foreground'
                    }`}>
                      {isInterviewer ? (
                        <UserCheck className="h-4 w-4" />
                      ) : (
                        <User className="h-4 w-4" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`font-semibold text-xs ${
                          isInterviewer ? 'text-primary' : 'text-foreground'
                        }`}>
                          {displayName}
                        </span>
                        {!message.isFinal && (
                          <span className="text-xs text-muted-foreground italic">(typing...)</span>
                        )}
                      </div>
                      <p className={`text-sm text-foreground ${!message.isFinal ? 'italic' : ''}`}>
                        {message.text}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {message.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

