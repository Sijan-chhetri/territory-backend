// config/clanEventDeepLink.js

const DEFAULT_PUBLIC_APP_URL =
  "https://territory-backend-3.onrender.com";

const trimTrailingSlash = (value) =>
  String(value || "").replace(/\/+$/, "");

export const buildClanEventDeepLink = ({ clanId }) => {
  const normalizedClanId = String(clanId || "").trim();

  if (!normalizedClanId) {
    throw new Error(
      "buildClanEventDeepLink requires a clanId",
    );
  }

  const publicBaseUrl = trimTrailingSlash(
    process.env.PUBLIC_APP_URL || DEFAULT_PUBLIC_APP_URL,
  );

  const url = new URL("/open/clan-event", publicBaseUrl);

  url.searchParams.set("clanId", normalizedClanId);

  return url.toString();
};
