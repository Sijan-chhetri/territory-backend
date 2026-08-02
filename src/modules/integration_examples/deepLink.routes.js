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
    return res.status(400).type("html").send(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Invalid DURO invitation</title>
        </head>
        <body>
          <h1>Invalid invitation</h1>
          <p>The club ID or event ID is missing from this invitation.</p>
        </body>
      </html>
    `);
  }

  const appUrl =
    `duro://social/clubs?clanId=${encodeURIComponent(clanId)}` +
    `&eventId=${encodeURIComponent(eventId)}`;

  const safeAppUrl = escapeHtml(appUrl);
  const safeClanId = escapeHtml(clanId);
  const safeEventId = escapeHtml(eventId);

  const androidStoreUrl =
    process.env.ANDROID_STORE_URL ||
    "https://play.google.com/store/apps/details?id=com.elevatetech.duro";

  const iosStoreUrl = process.env.IOS_STORE_URL || "";

  const userAgent = String(req.get("user-agent") || "");
  const isAndroid = /Android/i.test(userAgent);
  const isIos = /iPhone|iPad|iPod/i.test(userAgent);

  const automaticStoreUrl = isIos
    ? iosStoreUrl
    : isAndroid
      ? androidStoreUrl
      : "";

  const safeAndroidStoreUrl = escapeHtml(androidStoreUrl);
  const safeIosStoreUrl = escapeHtml(iosStoreUrl);

  return res.status(200).type("html").send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Open DURO Club Event</title>
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 24px;
            background: #f3f5f7;
            color: #15171a;
            font-family: Arial, Helvetica, sans-serif;
          }
          .card {
            width: min(100%, 460px);
            padding: 30px;
            border-radius: 24px;
            background: #ffffff;
            box-shadow: 0 16px 45px rgba(20, 30, 40, 0.12);
            text-align: center;
          }
          .brand {
            color: #45d62e;
            font-size: 30px;
            font-weight: 900;
            letter-spacing: 3px;
          }
          h1 { margin: 20px 0 10px; font-size: 25px; }
          p { color: #666d73; line-height: 1.6; }
          .button {
            display: block;
            margin-top: 14px;
            padding: 15px 18px;
            border-radius: 14px;
            background: #45d62e;
            color: white;
            text-decoration: none;
            font-weight: 800;
          }
          .button.secondary { background: #101418; }
          .small { margin-top: 18px; font-size: 12px; color: #8b9197; }
        </style>
      </head>
      <body>
        <main class="card">
          <div class="brand">DURO</div>
          <h1>Opening your club event</h1>
          <p>
            If DURO is installed, it will open directly on this event.
            Otherwise, install DURO and open the invitation again.
          </p>

          <a class="button" href="${safeAppUrl}">Open DURO</a>

          <a class="button secondary" href="${safeAndroidStoreUrl}">
            Get DURO for Android
          </a>

          ${
            iosStoreUrl
              ? `<a class="button secondary" href="${safeIosStoreUrl}">
                   Get DURO for iPhone
                 </a>`
              : ""
          }

          <div class="small">
            Club: ${safeClanId}<br />
            Event: ${safeEventId}
          </div>
        </main>

        <script>
          (function () {
            var appUrl = ${JSON.stringify(appUrl)};
            var storeUrl = ${JSON.stringify(automaticStoreUrl)};
            var fallbackTimer = null;

            function cancelFallback() {
              if (fallbackTimer !== null) {
                window.clearTimeout(fallbackTimer);
                fallbackTimer = null;
              }
            }

            document.addEventListener("visibilitychange", function () {
              if (document.visibilityState === "hidden") {
                cancelFallback();
              }
            });

            window.addEventListener("pagehide", cancelFallback);
            window.addEventListener("blur", cancelFallback);

            window.setTimeout(function () {
              window.location.href = appUrl;
            }, 150);

            if (storeUrl) {
              fallbackTimer = window.setTimeout(function () {
                if (document.visibilityState === "visible") {
                  window.location.replace(storeUrl);
                }
              }, 1800);
            }
          })();
        </script>
      </body>
    </html>
  `);
});

export default router;