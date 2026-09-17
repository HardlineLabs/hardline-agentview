import { useEffect, useRef, useState } from "react";
import { Download, LoaderCircle, X } from "lucide-react";
import { invoke } from "./api";
import { prepareDesktopUpdate } from "./desktop-bridge";
import type { UiUpdateStatus } from "../shared/ui-update";

export function DesktopUpdates() {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<UiUpdateStatus>();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        void invoke("ui.ready")
          .then(() => invoke("ui.status"))
          .then((info) => {
            setStatus(info);
            setMessage(info.message);
          })
          .catch(() => {});
      });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  async function update() {
    if (busy) return;
    dialog.current?.showModal();
    setMessage("");
    setBusy("Checking for a UI update…");
    let applying = false;
    try {
      const result = await invoke("ui.stage");
      if (!result.available) {
        setMessage("Your UI is up to date.");
        return;
      }
      setBusy("Saving your draft and updating…");
      await prepareDesktopUpdate();
      await invoke("ui.apply");
      applying = true;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "UI update failed. Try again.",
      );
    } finally {
      if (!applying) {
        setBusy("");
        dialog.current?.close();
      }
    }
  }
  return (
    <div className="desktop-updates">
      <button
        className="desktop-update-button"
        onClick={() => void update()}
        disabled={Boolean(busy)}
        title={
          status
            ? `UI: ${status.version} · Desktop: ${status.shellVersion}`
            : "Download the published desktop interface"
        }
      >
        <Download size={13} /> Update UI
      </button>
      {message && (
        <div className="desktop-update-message" role="status">
          <span>{message}</span>
          <button
            aria-label="Dismiss update message"
            onClick={() => setMessage("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <dialog
        className="desktop-update-dialog"
        ref={dialog}
        onCancel={(event) => event.preventDefault()}
      >
        <LoaderCircle size={20} className="spin" />
        <p>{busy}</p>
        <small>Your agent keeps working while the interface updates.</small>
      </dialog>
    </div>
  );
}
