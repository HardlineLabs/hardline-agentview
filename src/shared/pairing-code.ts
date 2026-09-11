import { decodeConnection } from "./pairing";

export const PAIRING_SERVICE = "https://app.hardline-labs.com/api/pair";
export function sixDigitCode(value: string) {
  const normalized = value.trim().replace(/[\s-]/g, "");
  return /^\d{6}$/.test(normalized) ? normalized : undefined;
}

export async function pairingRequest(
  action: "publish" | "claim" | "cancel",
  body: unknown,
  endpoint = PAIRING_SERVICE,
) {
  let response: Response;
  try {
    response = await fetch(`${endpoint}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
  } catch {
    throw new Error(
      "Pairing service could not be reached. Check your internet connection and try again.",
    );
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      result.error || "Pairing is temporarily unavailable. Try again shortly.",
    );
  return result;
}

export async function claimPairingCode(
  code: string,
  claimId: string,
  endpoint?: string,
) {
  const result = await pairingRequest("claim", { code, claimId }, endpoint);
  const config = decodeConnection(result.invitation);
  if (!config.remoteAddress || config.kind !== "invite")
    throw new Error(
      "This code has no remote connection. Create a new code in Host.",
    );
  return config;
}
