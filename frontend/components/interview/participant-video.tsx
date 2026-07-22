'use client';

import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { Card, CardContent } from '@/components/ui/card';
import { VideoOff } from 'lucide-react';
import { MicLevelMeter } from './mic-level-meter';
import { cn } from '@/lib/utils';

interface ParticipantVideoProps {
  room: Room | null;
  userName?: string;
  /** Notifies the parent so the video row can shrink when the camera is off. */
  onHasVideoChange?: (hasVideo: boolean) => void;
}

export function ParticipantVideo({
  room,
  userName = 'You',
  onHasVideoChange,
}: ParticipantVideoProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    onHasVideoChange?.(hasVideo);
  }, [hasVideo, onHasVideoChange]);

  useEffect(() => {
    // Only run when room is connected and video element exists
    if (!room || room.state !== 'connected') {
      setHasVideo(false);
      return;
    }
    if (!localVideoRef.current) return;

    // Idempotent attachment function - handles both event-based and reconciliation cases
    const attachIfExists = () => {
      for (const pub of room.localParticipant.videoTrackPublications.values()) {
        if (
          pub.source === Track.Source.Camera &&
          pub.track &&
          localVideoRef.current
        ) {
          try {
            console.log('🎥 Attaching local camera track');
            pub.track.attach(localVideoRef.current);
            setHasVideo(true);
            console.log('✅ Video track attached successfully');
            return true;
          } catch (error) {
            console.error('❌ Failed to attach video track:', error);
            setHasVideo(false);
            return false;
          }
        }
      }
      return false;
    };

    // Event handler for when tracks are published after listener is registered
    const handleLocalTrackPublished = (publication: any) => {
      if (
        publication?.source === Track.Source.Camera &&
        publication.track &&
        localVideoRef.current
      ) {
        console.log('🎥 Local camera track published event received');
        attachIfExists();
      }
    };

    // Handle track being unpublished (camera disabled)
    const handleLocalTrackUnpublished = (publication: any) => {
      if (publication?.source === Track.Source.Camera) {
        console.log('🎥 Local video track unpublished');
        setHasVideo(false);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = null;
        }
      }
    };

    // Register event listeners
    room.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
    room.on(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);

    // 🔑 CRITICAL: Reconcile immediately - handles case where track was published
    // before component mounted or before listener was registered
    attachIfExists();

    return () => {
      room.off(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
      room.off(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);
      // Cleanup: detach track on unmount
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
    };
  }, [room, room?.state]); // Re-run when room or room state changes

  return (
    // min-h-0 + overflow-hidden: without them the <video> falls back to its
    // intrinsic size and spills over the transcript below.
    <Card
      className={cn(
        'h-full w-full min-h-0 overflow-hidden',
        !hasVideo && 'py-0',
      )}
    >
      <CardContent
        className={cn(
          'h-full p-0 relative overflow-hidden',
          hasVideo ? 'bg-black rounded-lg' : 'bg-muted/60',
        )}
      >
        {/* Always render video element - track attachment happens regardless */}
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className={cn(
            'w-full h-full object-cover',
            !hasVideo && 'invisible absolute inset-0',
          )}
        />

        {hasVideo ? (
          <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 bg-black/60 text-white px-2 py-1 rounded z-10">
            <span className="text-xs truncate">{userName}</span>
            <div className="ml-auto">
              <MicLevelMeter room={room} compact />
            </div>
          </div>
        ) : (
          // Compact camera-off strip: name + mic + short status, no empty tile.
          <div className="h-full flex flex-col justify-center gap-1.5 px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <VideoOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium truncate">{userName}</span>
              <div className="ml-auto shrink-0">
                <MicLevelMeter room={room} compact />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground leading-tight">
              Camera off · audio only
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
