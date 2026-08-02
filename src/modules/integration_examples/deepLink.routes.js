// routes/deepLink.routes.js

import express from "express";

const router = express.Router();

const DEFAULT_ANDROID_PACKAGE =
  "com.elevatetech.duro";

const DEFAULT_IOS_BUNDLE_ID =
  "com.elevatetech.duro";

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

/**
 * Android App Links verification
 *
 * URL:
 * https://territory-backend-3.onrender.com/.well-known/assetlinks.json
 */
router.get(
  "/.well-known/assetlinks.json",
  (_req, res) => {
    const packageName = String(
      process.env.ANDROID_PACKAGE_NAME ||
        DEFAULT_ANDROID_PACKAGE,
    ).trim();

    const fingerprints = commaSeparatedValues(
      process.env.ANDROID_SHA256_CERT_FINGERPRINTS,
    );

    if (fingerprints.length === 0) {
      console.warn(
        "ANDROID_SHA256_CERT_FINGERPRINTS is empty. " +
          "Android App Links verification will fail.",
      );
    }

    const body = [
      {
        relation: [
          "delegate_permission/common.handle_all_urls",
        ],
        target: {
          namespace: "android_app",
          package_name: packageName,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ];

    return res
      .status(200)
      .set("Cache-Control", "public, max-age=3600")
      .type("application/json")
      .send(JSON.stringify(body, null, 2));
  },
);

/**
 * Apple Universal Links verification
 *
 * URL:
 * https://territory-backend-3.onrender.com/.well-known/apple-app-site-association
 */
router.get(
  "/.well-known/apple-app-site-association",
  (_req, res) => {
    const appleTeamId = String(
      process.env.APPLE_TEAM_ID || "",
    ).trim();

    const bundleId = String(
      process.env.IOS_BUNDLE_ID ||
        DEFAULT_IOS_BUNDLE_ID,
    ).trim();

    const appId =
      appleTeamId && bundleId
        ? `${appleTeamId}.${bundleId}`
        : "";

    if (!appId) {
      console.warn(
        "APPLE_TEAM_ID or IOS_BUNDLE_ID is missing. " +
          "Apple Universal Links verification will fail.",
      );
    }

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
                    comment:
                      "Open a DURO clan event invitation",
                  },
                ],
              },
            ]
          : [],
      },
    };

    return res
      .status(200)
      .set("Cache-Control", "public, max-age=3600")
      .type("application/json")
      .send(JSON.stringify(body, null, 2));
  },
);

/**
 * Browser fallback for clan-event invitations.
 *
 * Expected URL:
 * /open/clan-event?clanId=...&eventId=...
 */
router.get("/open/clan-event", (req, res) => {
  const clanId = String(
    req.query.clanId || "",
  ).trim();

  const eventId = String(
    req.query.eventId || "",
  ).trim();

  if (!clanId || !eventId) {
    return res.status(400).type("html").send(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />

          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
          />

          <title>Invalid DURO invitation</title>

          <style>
            * {
              box-sizing: border-box;
            }

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
              width: min(100%, 440px);
              padding: 30px;
              border-radius: 24px;
              background: #ffffff;
              box-shadow:
                0 16px 45px rgba(20, 30, 40, 0.12);
              text-align: center;
            }

            .brand {
              color: #45d62e;
              font-size: 30px;
              font-weight: 900;
              letter-spacing: 3px;
            }

            h1 {
              margin: 20px 0 10px;
              font-size: 25px;
            }

            p {
              color: #666d73;
              line-height: 1.6;
            }
          </style>
        </head>

        <body>
          <main class="card">
            <div class="brand">DURO</div>

            <h1>Invalid invitation</h1>

            <p>
              The club ID or event ID is missing from this
              invitation.
            </p>
          </main>
        </body>
      </html>
    `);
  }

  const appUrl =
    `duro://social/clubs` +
    `?clanId=${encodeURIComponent(clanId)}` +
    `&eventId=${encodeURIComponent(eventId)}`;

  const safeAppUrl = escapeHtml(appUrl);
  const safeClanId = escapeHtml(clanId);

  const androidStoreUrl = escapeHtml(
    process.env.ANDROID_STORE_URL ||
      "https://play.google.com/store/apps/details?id=com.elevatetech.duro",
  );

  const rawIosStoreUrl = String(
    process.env.IOS_STORE_URL || "",
  ).trim();

  const safeIosStoreUrl = rawIosStoreUrl
    ? escapeHtml(rawIosStoreUrl)
    : "";

  return res.status(200).type("html").send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />

        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />

        <meta name="theme-color" content="#101418" />

        <title>Open DURO Club Event</title>

        <style>
          * {
            box-sizing: border-box;
          }

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
            box-shadow:
              0 16px 45px rgba(20, 30, 40, 0.12);
            text-align: center;
          }

          .brand {
            color: #45d62e;
            font-size: 30px;
            font-weight: 900;
            letter-spacing: 3px;
          }

          h1 {
            margin: 20px 0 10px;
            font-size: 25px;
          }

          p {
            color: #666d73;
            line-height: 1.6;
          }

          .button {
            display: block;
            width: 100%;
            margin-top: 14px;
            padding: 15px 18px;
            border: 0;
            border-radius: 14px;
            background: #45d62e;
            color: #101418;
            text-decoration: none;
            font-size: 15px;
            font-weight: 800;
            cursor: pointer;
          }

          .button.secondary {
            background: #101418;
            color: #ffffff;
          }

          .small {
            margin-top: 18px;
            font-size: 12px;
            color: #8b9197;
          }
        </style>
      </head>

      <body>
        <main class="card">
          <div class="brand">DURO</div>

          <h1>Opening your club event</h1>

          <p>
            DURO will open the Social Clubs section and display
            this event.
          </p>

          <a
            class="button"
            href="${safeAppUrl}"
          >
            Open DURO
          </a>

          <a
            class="button secondary"
            href="${androidStoreUrl}"
          >
            Get DURO for Android
          </a>

          ${
            safeIosStoreUrl
              ? `
                <a
                  class="button secondary"
                  href="${safeIosStoreUrl}"
                >
                  Get DURO for iPhone
                </a>
              `
              : ""
          }

          <div class="small">
            Invitation club: ${safeClanId}
          </div>
        </main>

        <script>
          window.setTimeout(function () {
            window.location.href = ${JSON.stringify(appUrl)};
          }, 350);
        </script>
      </body>
    </html>
  `);
});

export default router;