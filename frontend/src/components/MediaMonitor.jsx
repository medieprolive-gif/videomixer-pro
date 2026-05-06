import { useEffect, useRef, useState } from "react";
import { streamUrl, thumbUrl } from "../lib/api";

/**
 * MediaMonitor - renders a video or image media item and either:
 * - mirrors a synced playback state (synced=true), used for the PGM monitor & /display, or
 * - allows local control (synced=false), used for the PVW preview.
 *
 * Props:
 *  - media: media object ({id, media_type, duration, content_type}) or null
 *  - syncedState: when provided, overrides local playback (for PGM mirror)
 *  - autoplayOnSelect: when true, video plays on media change (for local PVW preview)
 *  - onEnded(mediaId): callback when video/image timer ends
 *  - onTimeUpdate(time): periodic time updates (for PGM mirror to report back)
 *  - className: container classes
 *  - showFreezeBadge: show "FROZEN" overlay when paused at non-zero or end
 *  - testId: data-testid prefix
 */
export default function MediaMonitor({
  media,
  syncedState,
  onEnded,
  onTimeUpdate,
  className = "",
  showFreezeBadge = false,
  testId = "monitor",
}) {
  const videoRef = useRef(null);
  const [duration, setDuration] = useState(0);
  const [localTime, setLocalTime] = useState(0);
  const [localPlaying, setLocalPlaying] = useState(false);
  const imageTimer = useRef(null);

  const isVideo = media?.media_type === "video";
  const isImage = media?.media_type === "image";

  // Video src swap
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isVideo) return;
    v.src = media ? streamUrl(media.id) : "";
    v.load();
    setLocalTime(0);
  }, [media?.id, isVideo]);

  // Apply synced state to video (PGM mirror behavior)
  useEffect(() => {
    if (!syncedState) return;
    const v = videoRef.current;

    // Image timer driven by syncedState
    if (isImage) {
      if (imageTimer.current) {
        clearTimeout(imageTimer.current);
        imageTimer.current = null;
      }
      if (syncedState.is_playing && media) {
        const remainingMs = Math.max(
          200,
          ((media.duration || 5) - (syncedState.current_time || 0)) * 1000
        );
        imageTimer.current = setTimeout(() => {
          if (onEnded) onEnded(media.id);
        }, remainingMs);
      }
      return;
    }

    if (!v || !isVideo) return;
    v.volume = syncedState.volume ?? 1;
    v.muted = !!syncedState.muted;
    v.loop = !!syncedState.loop;

    if (typeof syncedState.current_time === "number") {
      const drift = Math.abs(v.currentTime - syncedState.current_time);
      if (drift > 1.0) {
        try {
          v.currentTime = syncedState.current_time;
        } catch (_) {
          /* noop */
        }
      }
    }

    if (syncedState.is_playing) {
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      v.pause();
    }
  }, [syncedState, isImage, isVideo, media, onEnded]);

  // Video event wiring
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isVideo) return;
    const onMeta = () => setDuration(v.duration || 0);
    const onTime = () => {
      setLocalTime(v.currentTime || 0);
      if (onTimeUpdate) onTimeUpdate(v.currentTime || 0);
    };
    const onPlay = () => setLocalPlaying(true);
    const onPause = () => setLocalPlaying(false);
    const onEnd = () => {
      if (onEnded && media) onEnded(media.id);
    };
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnd);
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnd);
    };
  }, [isVideo, media?.id, onEnded, onTimeUpdate]);

  // Cleanup image timer
  useEffect(
    () => () => {
      if (imageTimer.current) clearTimeout(imageTimer.current);
    },
    []
  );

  if (!media) {
    return (
      <div
        data-testid={`${testId}-empty`}
        className={`flex items-center justify-center bg-black ${className}`}
      >
        <div className="text-zinc-700 text-xs uppercase tracking-[0.25em] font-mono">
          Tom
        </div>
      </div>
    );
  }

  // Determine "frozen" state for badge:
  // - synced video: not playing AND has been moved (time>0 OR ended near duration)
  // - synced image: not playing AND there is media
  const synced = !!syncedState;
  const playing = synced ? !!syncedState?.is_playing : localPlaying;
  const frozen =
    showFreezeBadge &&
    !playing &&
    !!media &&
    (synced
      ? (syncedState?.current_time || 0) > 0.05 ||
        (isImage && (syncedState?.current_time || 0) > 0)
      : localTime > 0.05);

  return (
    <div
      data-testid={testId}
      className={`relative bg-black overflow-hidden ${className}`}
    >
      {isVideo && (
        <video
          ref={videoRef}
          data-testid={`${testId}-video`}
          className="w-full h-full object-contain bg-black"
          playsInline
          preload="metadata"
        />
      )}
      {isImage && (
        <img
          data-testid={`${testId}-image`}
          src={thumbUrl(media.id)}
          alt={media.filename || ""}
          className="w-full h-full object-contain bg-black"
        />
      )}

      {frozen && (
        <div
          data-testid={`${testId}-freeze-badge`}
          className="absolute top-2 left-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] text-white font-mono bg-black/70 backdrop-blur-sm px-2 py-1 rounded border border-white/10"
        >
          <span className="w-1 h-1 rounded-full bg-white" />
          Frozen
        </div>
      )}
    </div>
  );
}

export function exposeMonitorRefs(ref) {
  return ref;
}
