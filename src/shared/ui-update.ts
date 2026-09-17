// Increment when renderer/native bridge compatibility changes.
export const UI_BRIDGE_VERSION = 1;
export const UI_UPDATE_URL =
  "https://hardline-labs.com/updates/agentview/desktop/latest.json";
export const UI_UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAnDZufYnyAKRpF34RYXrPw7TSweuWzeOJDbpjNLG7LeU=
-----END PUBLIC KEY-----
`;

export interface UiManifest {
  schema: 1;
  version: string;
  bridge: number;
  publishedAt: number;
  sha256: string;
  bytes: number;
  bundle: string;
}
export interface SignedUiManifest {
  payload: string;
  signature: string;
}
export interface UiUpdateStatus {
  version: string;
  shellVersion: string;
  message: string;
}
