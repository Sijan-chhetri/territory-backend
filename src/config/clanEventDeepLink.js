// config/clanEventDeepLink.js

const DEFAULT_PUBLIC_APP_URL =
  "https://territory-backend-3.onrender.com";

const trimTrailingSlash = (value) =>
  String(value || "").replace(/\/+$/, "");

export const buildClanEventDeepLink = ({ clanId, eventId }) => {
  const normalizedClanId = String(clanId || "").trim();
  const normalizedEventId = String(eventId || "").trim();

  if (!normalizedClanId) {
    throw new Error("buildClanEventDeepLink requires a clanId");
  }

  if (!normalizedEventId) {
    throw new Error("buildClanEventDeepLink requires an eventId");
  }

  const publicBaseUrl = trimTrailingSlash(
    process.env.PUBLIC_APP_URL || DEFAULT_PUBLIC_APP_URL,
  );

  const url = new URL("/open/clan-event", publicBaseUrl);
  url.searchParams.set("clanId", normalizedClanId);
  url.searchParams.set("eventId", normalizedEventId);

  return url.toString();
};