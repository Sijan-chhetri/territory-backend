// routes/deepLink.routes.js

import express from "express";

const router = express.Router();

const DEFAULT_ANDROID_PACKAGE = "com.elevatetech.duro";
const DEFAULT_IOS_BUNDLE_ID = "com.elevatetech.duro";

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const commaSeparatedValues = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

router.get("/.well-known/assetlinks.json", (_req, res) => {
  const packageName =
    process.env.ANDROID_PACKAGE_NAME || DEFAULT_ANDROID_PACKAGE;

  const fingerprints = commaSeparatedValues(
    process.env.ANDROID_SHA256_CERT_FINGERPRINTS,
  );

  res
    .status(200)
    .type("application/json")
    .send(
      JSON.stringify(
        [
          {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: {
              namespace: "android_app",
              package_name: packageName,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ],
        null,
        2,
      ),
    );
});

router.get(
  "/.well-known/apple-app-site-association",
  (_req, res) => {
    const appleTeamId = String(process.env.APPLE_TEAM_ID || "").trim();

    const bundleId = String(
      process.env.IOS_BUNDLE_ID || DEFAULT_IOS_BUNDLE_ID,
    ).trim();

    const appId =
      appleTeamId && bundleId ? `${appleTeamId}.${bundleId}` : "";

    const body = {
      applinks: {
        apps: [],
        details: appId
          ? [
              {
                appIDs: [appId],
                components: [
                  {
                    "/": "/open/clan-event",
                    comment: "Open DURO directly on a club event",
                  },
                ],
              },
            ]
          : [],
      },
    };

    res
      .status(200)
      .type("application/json")
      .send(JSON.stringify(body, null, 2));
  },
);

router.get("/open/clan-event", (req, res) => {
  const clanId = String(req.query.clanId || "").trim();
  const eventId = String(req.query.eventId || "").trim();

  if (!clanId || !eventId) {
    return res.status(400).json({
      success: false,
      message: "Both clanId and eventId are required.",
    });
  }

  // This executes only when Android/iOS did not open DURO.
  // Usually this means DURO is not installed or the link is not verified.
  const fallbackUrl = new URL("https://elevatetch.com");

  fallbackUrl.searchParams.set(
    "source",
    "duro-clan-event-invitation",
  );

  return res.redirect(302, fallbackUrl.toString());
});

export default router;