import { useEffect, useState } from "react";
import { Download, RefreshCw, X, Share, PlusSquare } from "lucide-react";
import { prepareUpdate } from "./bridge";

type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export function PwaControls({ selectedThread }: { selectedThread?: string }) {
  const [waiting, setWaiting] = useState<ServiceWorker>();
  const [install, setInstall] = useState<InstallPrompt>();
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [standalone, setStandalone] = useState(
    matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
  );
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    let checked = 0;
    const check = () => {
      if (document.hidden || Date.now() - checked < 60_000) return;
      checked = Date.now();
      void registration?.update().catch(() => {});
    };
    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        if (disposed) return;
        registration = reg;
        if (reg.waiting) setWaiting(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (
              !disposed &&
              worker.state === "installed" &&
              reg.active &&
              reg.active !== worker
            )
              setWaiting(worker);
          });
        });
        check();
      })
      .catch(() => {
        if (!disposed)
          setError(
            "Offline installation is unavailable. You can still use AgentView while online.",
          );
      });
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    const interval = setInterval(check, 5 * 60_000);
    return () => {
      disposed = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
    };
  }, []);
  useEffect(() => {
    const prompt = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallPrompt);
    };
    const installed = () => {
      setStandalone(true);
      setInstall(undefined);
      setHelp(false);
    };
    window.addEventListener("beforeinstallprompt", prompt);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", prompt);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  const update = async () => {
    setBusy(true);
    setError("");
    try {
      await prepareUpdate(selectedThread);
      const reload = () => location.reload();
      navigator.serviceWorker.addEventListener("controllerchange", reload, {
        once: true,
      });
      waiting?.postMessage({ type: "ACTIVATE_UPDATE" });
      setTimeout(() => {
        navigator.serviceWorker.removeEventListener("controllerchange", reload);
        setBusy(false);
        setError(
          "Update is taking longer than expected. Close and reopen AgentView when convenient.",
        );
      }, 10_000);
    } catch {
      setBusy(false);
      setError(
        "Could not save your draft for the update. Keep this window open and try again after your current action finishes.",
      );
    }
  };
  if (standalone && !waiting && !error && !help) return null;
  return (
    <>
      <div className="pwa-bar">
        <span>
          {waiting
            ? "A fresh version is ready"
            : "Your workspace, one tap away"}
        </span>
        {waiting ? (
          <button disabled={busy} onClick={() => void update()}>
            <RefreshCw size={14} className={busy ? "spin" : ""} />
            {busy ? "Saving draft…" : "Update & reload"}
          </button>
        ) : (
          !standalone && (
            <button
              onClick={async () => {
                if (install) {
                  await install.prompt();
                  await install.userChoice;
                  setInstall(undefined);
                } else setHelp(true);
              }}
            >
              <Download size={14} />
              Install app
            </button>
          )
        )}
      </div>
      {error && (
        <div className="pwa-error" role="alert">
          {error}
          <button
            aria-label="Dismiss update message"
            onClick={() => setError("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="install-card"
            role="dialog"
            aria-modal="true"
            aria-label="Install AgentView"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              autoFocus
              className="icon-button install-close"
              aria-label="Close install instructions"
              onClick={() => setHelp(false)}
            >
              <X />
            </button>
            <img src="/icons/icon-192.png" width="68" height="68" alt="" />
            <span className="eyebrow">HARDLINE AGENTVIEW</span>
            <h2>A home for your workspace.</h2>
            <p>
              On iPhone, open this page in <strong>Safari</strong>, then:
            </p>
            <ol>
              <li>
                <Share size={18} />
                Open the Share menu (it may be under •••).
              </li>
              <li>
                <PlusSquare size={18} />
                Choose <strong>Add to Home Screen</strong>.
              </li>
              <li>
                Keep <strong>Open as Web App</strong> enabled if shown, then tap{" "}
                <strong>Add</strong>.
              </li>
            </ol>
            <p className="install-note">
              Open AgentView from its new icon, then pair with your computer. On
              other devices, use your browser’s Install app option.
            </p>
            <button
              className="primary full-width"
              onClick={() => setHelp(false)}
            >
              Got it
            </button>
          </section>
        </div>
      )}
    </>
  );
}
