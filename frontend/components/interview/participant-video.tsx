'use client';

import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { Card, CardContent } from '@/components/ui/card';
import { VideoOff } from 'lucide-react';
import { MicLevelMeter } from './mic-level-meter';

interface ParticipantVideoProps {
  room: Room | null;
  userName?: string;
}

export function ParticipantVideo({ room, userName = 'You' }: ParticipantVideoProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    // Only run when room is connected and video element exists
    if (!room || room.state !== 'connected' || !localVideoRef.current) return;

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
    <Card className="h-full w-full min-h-0 overflow-hidden">
      <CardContent className="h-full p-0 relative bg-black rounded-lg overflow-hidden">
        {/* Always render video element - track attachment happens regardless */}
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />
        {/* Show overlay when no video track is available */}
        {!hasVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-muted/80 pointer-events-none">
            <VideoOff className="h-6 w-6 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">Camera off</p>
            <p className="text-muted-foreground text-xs">Audio only — turn the camera on below if you want it</p>
          </div>
        )}
        {/* Name + live mic level, so an unheard user can tell whether their
            audio is actually reaching the room */}
        <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 bg-black/60 text-white px-2 py-1 rounded z-10">
          <span className="text-xs truncate">{userName}</span>
          <div className="ml-auto">
            <MicLevelMeter room={room} compact />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

