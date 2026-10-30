import { useState } from "react";
import {
  LiveKitRoom,
  VideoConference,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { X, Video, Mic, ArrowRight } from "lucide-react";
import type { Meeting } from "./api";
export interface MeetingAccess {
  token: string;
  url: string;
  meeting: Meeting;
}
export function MeetingRoom({
  access,
  onClose,
  onEnd,
  isHost,
  onJoin,
}: {
  access: MeetingAccess;
  onJoin: () => Promise<MeetingAccess>;
  onClose: () => void;
  onEnd: () => Promise<void>;
  isHost: boolean;
}) {
  const [activeAccess, setActiveAccess] = useState(access),
    [joining, setJoining] = useState(false),
    [joined, setJoined] = useState(false),
    [camera, setCamera] = useState(false),
    [mic, setMic] = useState(true),
    [error, setError] = useState("");
  return (
    <section
      className="meeting-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={access.meeting.title}
    >
      <header>
        <span>
          <Video size={19} />
          <strong>{access.meeting.title}</strong>
          <small>ChatFinity Meet</small>
        </span>
        <div>
          {isHost && (
            <button
              className="danger"
              onClick={() => void onEnd().catch((e) => setError(e.message))}
            >
              End for everyone
            </button>
          )}
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Leave meeting"
          >
            <X />
          </button>
        </div>
      </header>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {joined ? (
        <LiveKitRoom
          serverUrl={activeAccess.url}
          token={activeAccess.token}
          connect={true}
          audio={mic}
          video={camera}
          onDisconnected={onClose}
          onError={(e) => setError(e.message)}
          data-lk-theme="default"
        >
          <VideoConference />
        </LiveKitRoom>
      ) : (
        <div className="meeting-prejoin">
          <div className="prejoin-icon">
            <Video size={38} />
          </div>
          <span className="eyebrow">A REAL CONVERSATION, ONE CLICK AWAY</span>
          <h1>Ready when you are.</h1>
          <p>
            Choose how you join. Your browser will ask before using your camera
            or microphone.
          </p>
          <div className="prejoin-options">
            <label>
              <input
                type="checkbox"
                checked={mic}
                onChange={(e) => setMic(e.target.checked)}
              />
              <Mic size={18} /> Microphone
            </label>
            <label>
              <input
                type="checkbox"
                checked={camera}
                onChange={(e) => setCamera(e.target.checked)}
              />
              <Video size={18} /> Camera
            </label>
          </div>
          <button
            className="primary"
            disabled={joining}
            onClick={async () => {
              setJoining(true);
              try {
                setActiveAccess(await onJoin());
                setJoined(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setJoining(false);
              }
            }}
          >
            {joining ? "Connecting…" : "Join meeting"} <ArrowRight size={18} />
          </button>
          <small>
            Audio, video and screen sharing are provided by this server’s
            LiveKit service.
          </small>
        </div>
      )}
    </section>
  );
}
