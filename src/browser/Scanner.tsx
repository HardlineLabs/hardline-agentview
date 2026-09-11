import { useEffect, useRef, useState } from "react";
import { X, Camera, LoaderCircle } from "lucide-react";
import jsQR from "jsqr";
import { sixDigitCode } from "../shared/pairing-code";

export function Scanner({
  onScan,
  onClose,
}: {
  onScan: (value: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const scan = () => {
      if (stopped) return;
      const camera = video.current;
      if (camera && camera.readyState >= 2 && camera.videoWidth) {
        const scale = Math.min(1, 900 / camera.videoWidth);
        canvas.width = camera.videoWidth * scale;
        canvas.height = camera.videoHeight * scale;
        context.drawImage(camera, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(pixels.data, pixels.width, pixels.height, {
          inversionAttempts: "attemptBoth",
        });
        let value = result?.data || "";
        if (value.startsWith("https://app.hardline-labs.com/")) {
          try {
            value =
              sixDigitCode(
                new URLSearchParams(new URL(value).hash.slice(1)).get("pair") ||
                  "",
              ) || "";
          } catch {
            value = "";
          }
        }
        if (value.startsWith("agentview://") || sixDigitCode(value)) {
          onScan(value);
          return;
        }
      }
      timer = setTimeout(scan, 180);
    };
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error(
            "Camera unavailable. Open the HTTPS app in Safari, or paste the invitation instead.",
          );
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.current!.srcObject = stream;
        await video.current!.play();
        setReady(true);
        scan();
      } catch (e) {
        if (!stopped)
          setError(
            e instanceof DOMException && e.name === "NotAllowedError"
              ? "Camera access was declined. Allow camera access in Safari settings, or close this view and paste the invitation."
              : "Could not open the camera. Close this view and paste the invitation instead.",
          );
      }
    })();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const hidden = () => {
      if (document.hidden) onClose();
    };
    window.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      window.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  return (
    <div
      className="scanner-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Scan pairing invitation"
    >
      <header>
        <span>
          <Camera size={20} /> Pair your workspace
        </span>
        <button
          autoFocus
          className="icon-button"
          aria-label="Close camera"
          onClick={onClose}
        >
          <X />
        </button>
      </header>
      <div className="scanner-view">
        <video ref={video} playsInline muted />
        <div className="scanner-frame" />
        {!ready && !error && <LoaderCircle className="spin" />}
      </div>
      <p role={error ? "alert" : undefined}>
        {error ||
          "Keep the full QR code from AgentView Host inside the camera view, including its white border."}
      </p>
      <button className="secondary" onClick={onClose}>
        Paste an invitation instead
      </button>
    </div>
  );
}
