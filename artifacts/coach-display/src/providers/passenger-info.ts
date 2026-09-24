import type { PassengerLanguage } from '@/lib/translations';
export type PassengerInfoCard = { title: string; text: string };
export type LocalizedPassengerInfoContent = Record<PassengerLanguage, {
  destinations: PassengerInfoCard[];
  fares: PassengerInfoCard[];
  guide: PassengerInfoCard[];
  contact: PassengerInfoCard[];
}>;
export type PassengerInfoContent = LocalizedPassengerInfoContent;

export interface PassengerInfo {
  content: LocalizedPassengerInfoContent;
  reviewedAt: string;
  checkedAt: string | null;
  stale: boolean;
  ageDays: number;
  changesDetected: boolean;
  sourceUrls: string[];
  canManage: boolean;
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json() as PassengerInfo & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed with status ${response.status}`);
  return body;
}

export const getPassengerInfo = (signal?: AbortSignal) => request("/api/passenger-info", { signal });
export async function authorizePassengerInfo(key: string) {
  const response = await fetch("/api/passenger-info/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  if (!response.ok) {
    const body = await response.json() as { error?: string };
    throw new Error(body.error || "Staff authorization failed.");
  }
  return getPassengerInfo();
}
export const checkPassengerInfoWebsite = () => request("/api/passenger-info/check", { method: "POST" });
export const approvePassengerInfo = (content: PassengerInfoContent) => request("/api/passenger-info", {
  method: "PUT",
  body: JSON.stringify({ content }),
});