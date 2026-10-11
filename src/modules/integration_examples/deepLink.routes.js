// routes/deepLink.routes.js

import express from "express";

const router = express.Router();

const DEFAULT_ANDROID_PACKAGE = "com.elevatetech.duro";
const DEFAULT_IOS_BUNDLE_ID = "com.elevatetech.duro";

const DEFAULT_ANDROID_SHA256 =
  "83:84:48:A4:B1:66:CE:C0:B7:4D:1F:2E:49:A3:2D:26:B0:D2:16:B7:7B:BE:10:57:9D:D7:EB:21:96:69:17:CA";

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

/*
|--------------------------------------------------------------------------
| Android App Links Verification
|--------------------------------------------------------------------------
| URL:
| https://territory-backend-3.onrender.com/.well-known/assetlinks.json
|--------------------------------------------------------------------------
*/

router.get("/.well-known/assetlinks.json", (_req, res) => {
  const packageName =
    process.env.ANDROID_PACKAGE_NAME || DEFAULT_ANDROID_PACKAGE;

  const fingerprints = commaSeparatedValues(
    process.env.ANDROID_SHA256_CERT_FINGERPRINTS || DEFAULT_ANDROID_SHA256,
  );

  const assetLinks = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];

  res
    .status(200)
    .setHeader("Content-Type", "application/json")
    .send(JSON.stringify(assetLinks, null, 2));
});

/*
|--------------------------------------------------------------------------
| iOS Universal Links Verification
|--------------------------------------------------------------------------
| URL:
| https://territory-backend-3.onrender.com/.well-known/apple-app-site-association
|--------------------------------------------------------------------------
*/

router.get("/.well-known/apple-app-site-association", (_req, res) => {
  const appleTeamId = String(process.env.APPLE_TEAM_ID || "").trim();

  const bundleId = String(
    process.env.IOS_BUNDLE_ID || DEFAULT_IOS_BUNDLE_ID,
  ).trim();

  const appId = appleTeamId && bundleId ? `${appleTeamId}.${bundleId}` : "";

  const association = {
    applinks: {
      apps: [],

      details: appId
        ? [
            {
              appIDs: [appId],

              components: [
                {
                  "/": "/open/*",
                  comment: "Open DURO deep links",
                },
              ],
            },
          ]
        : [],
    },
  };

  res
    .status(200)
    .setHeader("Content-Type", "application/json")
    .send(JSON.stringify(association, null, 2));
});

/*
|--------------------------------------------------------------------------
| DURO Club Event Deep Link
|--------------------------------------------------------------------------
|
| Example:
|
| https://territory-backend-3.onrender.com/open/clan-event?
| clanId=123&eventId=456
|
|--------------------------------------------------------------------------
*/

router.get("/open/clan-event", (req, res) => {
  const clanId = String(req.query.clanId || "").trim();

  const eventId = String(req.query.eventId || "").trim();

  if (!clanId || !eventId) {
    return res.status(400).type("html").send(`
        <!doctype html>

        <html>

        <head>
          <title>
            Invalid DURO Invitation
          </title>
        </head>

        <body>

          <h1>
            Invalid invitation
          </h1>

          <p>
            Club ID or Event ID missing.
          </p>

        </body>

        </html>
      `);
  }

  const appUrl =
    `duro://social/clubs?clanId=${encodeURIComponent(clanId)}` +
    `&eventId=${encodeURIComponent(eventId)}`;

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

  const safeAppUrl = escapeHtml(appUrl);

  const safeAndroidStore = escapeHtml(androidStoreUrl);

  const safeIosStore = escapeHtml(iosStoreUrl);

  return res.status(200).type("html").send(`

<!doctype html>

<html>

<head>

<meta charset="utf-8"/>

<meta name="viewport"
content="width=device-width, initial-scale=1"/>


<title>
Open DURO Club Event
</title>


<style>

body{

margin:0;

min-height:100vh;

display:flex;

align-items:center;

justify-content:center;

background:#f3f5f7;

font-family:Arial;

padding:20px;

}


.card{

background:white;

padding:30px;

border-radius:24px;

max-width:450px;

text-align:center;

box-shadow:
0 15px 40px rgba(0,0,0,.15);

}


.brand{

font-size:32px;

font-weight:900;

color:#45d62e;

letter-spacing:4px;

}


.button{

display:block;

padding:15px;

margin-top:15px;

border-radius:14px;

background:#45d62e;

color:white;

text-decoration:none;

font-weight:bold;

}


.dark{

background:#111;

}


</style>


</head>


<body>


<div class="card">


<div class="brand">
DURO
</div>


<h2>
Opening Club Event
</h2>


<p>
If DURO is installed, it will open automatically.
</p>



<a class="button"
href="${safeAppUrl}">
Open DURO
</a>



<a class="button dark"
href="${safeAndroidStore}">
Install DURO
</a>


${
  iosStoreUrl
    ? `
<a class="button dark"
href="${safeIosStore}">
Install iOS App
</a>
`
    : ""
}



</div>



<script>

(function(){


const appUrl =
${JSON.stringify(appUrl)};


const storeUrl =
${JSON.stringify(automaticStoreUrl)};



let timer;



document.addEventListener(
"visibilitychange",
()=>{

if(
document.visibilityState==="hidden"
){

clearTimeout(timer);

}

}

);



setTimeout(()=>{

window.location.href =
appUrl;


},150);



if(storeUrl){


timer=setTimeout(()=>{


if(
document.visibilityState==="visible"
){


window.location.replace(
storeUrl
);


}


},1800);


}



})();

</script>



</body>

</html>

`);
});

/*
|--------------------------------------------------------------------------
| DURO Standalone Event Deep Link
|--------------------------------------------------------------------------
|
| Example:
|
| https://territory-backend-3.onrender.com/open/event?eventId=123
|
|--------------------------------------------------------------------------
*/

router.get("/open/event", (req, res) => {
  res.removeHeader("Content-Security-Policy");
  const eventId = String(req.query.eventId || "").trim();

  if (!eventId) {
    return res.status(400).type("html").send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8"/>
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
          />
          <title>Invalid DURO Event</title>
        </head>

        <body
          style="
            margin:0;
            min-height:100vh;
            display:flex;
            align-items:center;
            justify-content:center;
            background:#050705;
            color:#fff;
            font-family:Arial,Helvetica,sans-serif;
          "
        >
          <div style="text-align:center;">
            <h2>Invalid event</h2>
            <p style="color:#9ca49c;">
              Event ID is missing.
            </p>
          </div>
        </body>
      </html>
    `);
  }

  // ----------------------------------------------------------
  // DURO APP LINK
  // ----------------------------------------------------------

  const appUrl = `duro://event/${encodeURIComponent(eventId)}`;

  // ----------------------------------------------------------
  // STORE LINKS
  // ----------------------------------------------------------

  const androidStoreUrl =
    process.env.ANDROID_STORE_URL ||
    "https://play.google.com/store/apps/details?id=com.elevatetech.duro";

  const iosStoreUrl = process.env.IOS_STORE_URL || "";

  // ----------------------------------------------------------
  // DURO LOGO
  // ----------------------------------------------------------

  const duroLogoUrl = process.env.DURO_LOGO_URL;

  // ----------------------------------------------------------
  // DEVICE DETECTION
  // ----------------------------------------------------------

  const userAgent = String(req.get("user-agent") || "");

  const isAndroid = /Android/i.test(userAgent);

  const isIos = /iPhone|iPad|iPod/i.test(userAgent);

  const automaticStoreUrl = isIos
    ? iosStoreUrl
    : isAndroid
      ? androidStoreUrl
      : "";

  // ----------------------------------------------------------
  // SAFE HTML VALUES
  // ----------------------------------------------------------

  const safeAppUrl = escapeHtml(appUrl);

  const safeAndroidStore = escapeHtml(androidStoreUrl);

  const safeIosStore = escapeHtml(iosStoreUrl);

  const safeLogoUrl = escapeHtml(duroLogoUrl);

  // ----------------------------------------------------------
  // LANDING PAGE
  // ----------------------------------------------------------

  return res.status(200).type("html").send(`
<!doctype html>

<html lang="en">

<head>

  <meta charset="utf-8"/>

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  />

  <meta
    name="theme-color"
    content="#060806"
  />

  <title>Open Event in DURO</title>

  <style>

    * {
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }

    html,
    body {
      margin: 0;
      padding: 0;
      min-height: 100%;
    }

    body {
      min-height: 100vh;

      display: flex;
      align-items: center;
      justify-content: center;

      padding: 24px;

      background:
        radial-gradient(
          circle at 50% -10%,
          rgba(232, 255, 99, 0.11),
          transparent 34%
        ),
        #050705;

      color: #ffffff;

      font-family:
        Inter,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        Arial,
        sans-serif;
    }

    .page {
      width: 100%;
      max-width: 430px;
    }

    .card {
      position: relative;

      width: 100%;

      padding: 34px 26px 25px;

      overflow: hidden;

      border-radius: 28px;

      background:
        linear-gradient(
          180deg,
          rgba(18, 22, 18, 0.98) 0%,
          rgba(10, 13, 10, 0.98) 100%
        );

      border: 1px solid
        rgba(255, 255, 255, 0.07);

      box-shadow:
        0 30px 80px rgba(0, 0, 0, 0.45);
    }

    .glow {
      position: absolute;

      width: 190px;
      height: 190px;

      top: -110px;
      left: 50%;

      transform: translateX(-50%);

      border-radius: 50%;

      background:
        rgba(232, 255, 99, 0.15);

      filter: blur(55px);

      pointer-events: none;
    }

    .content {
      position: relative;
      z-index: 2;
    }

    .logo-area {
      display: flex;
      align-items: center;
      justify-content: center;

      margin-bottom: 20px;
    }

    .logo {
      display: block;

      max-width: 150px;
      width: auto;
      height: 64px;

      object-fit: contain;
    }

    .event-label {
      display: inline-flex;

      align-items: center;
      justify-content: center;

      gap: 7px;

      padding: 7px 11px;

      margin-bottom: 15px;

      border-radius: 999px;

      background:
        rgba(232, 255, 99, 0.08);

      border: 1px solid
        rgba(232, 255, 99, 0.13);

      color: #e8ff63;

      font-size: 10px;
      font-weight: 800;

      letter-spacing: 1.3px;
    }

    .event-dot {
      width: 5px;
      height: 5px;

      border-radius: 50%;

      background: #e8ff63;

      box-shadow:
        0 0 8px rgba(232, 255, 99, 0.8);
    }

    .center {
      text-align: center;
    }

    h1 {
      margin: 0;

      color: #ffffff;

      font-size: 29px;
      line-height: 1.12;

      letter-spacing: -0.8px;

      font-weight: 850;
    }

    .subtitle {
      max-width: 340px;

      margin:
        13px auto 0;

      color: #929a92;

      font-size: 14px;
      line-height: 1.55;

      font-weight: 450;
    }

    .actions {
      margin-top: 27px;
    }

    .button {
      width: 100%;

      display: flex;

      align-items: center;
      justify-content: center;

      min-height: 56px;

      padding:
        15px 18px;

      margin-top: 10px;

      border-radius: 16px;

      text-decoration: none;

      font-size: 14px;
      font-weight: 800;

      letter-spacing: -0.1px;

      transition:
        transform 0.16s ease,
        opacity 0.16s ease,
        border-color 0.16s ease;
    }

    .button:active {
      transform:
        scale(0.985);
    }

    .primary {
      background: #e8ff63;

      color: #070907;

      box-shadow:
        0 9px 28px
        rgba(232, 255, 99, 0.12);
    }

    .secondary {
      background:
        rgba(255, 255, 255, 0.035);

      border:
        1px solid
        rgba(255, 255, 255, 0.09);

      color: #f1f3f1;
    }

    .secondary:hover {
      border-color:
        rgba(232, 255, 99, 0.20);
    }

    .separator {
      display: flex;

      align-items: center;

      gap: 12px;

      margin:
        19px 0 5px;

      color: #626962;

      font-size: 9px;
      font-weight: 700;

      letter-spacing: 1.1px;
    }

    .separator::before,
    .separator::after {
      content: "";

      flex: 1;

      height: 1px;

      background:
        rgba(255, 255, 255, 0.06);
    }

    .footer {
      margin-top: 20px;

      text-align: center;

      color: #626a62;

      font-size: 10px;
      line-height: 1.5;

      font-weight: 600;
    }

    @media (max-width: 480px) {

      body {
        padding: 17px;
      }

      .card {
        padding:
          30px 20px 22px;

        border-radius: 25px;
      }

      .logo {
        height: 57px;
        max-width: 135px;
      }

      h1 {
        font-size: 26px;
      }

      .subtitle {
        font-size: 13px;
      }

      .button {
        min-height: 54px;
      }
    }

  </style>

</head>

<body>

  <main class="page">

    <section class="card">

      <div class="glow"></div>

      <div class="content">

        <!-- DURO LOGO -->

        <div class="logo-area">

          <img
            class="logo"
            src="${safeLogoUrl}"
            alt="DURO"
            onerror="
              this.style.display='none';
              document.getElementById(
                'logoFallback'
              ).style.display='block';
            "
          />

          <div
            id="logoFallback"
            style="
              display:none;
              color:#e8ff63;
              font-size:30px;
              font-weight:900;
              letter-spacing:5px;
            "
          >
            DURO
          </div>

        </div>


        <div class="center">


          <h1>
            Open this event<br/>
            in DURO
          </h1>


          <p class="subtitle">

            View the event, join runners,
            and track your run with the
            DURO community.

          </p>

        </div>


        <div class="actions">

          <a
            class="button primary"
            href="${safeAppUrl}"
          >
            Open in DURO
          </a>


          <div class="separator">
            DON'T HAVE DURO?
          </div>


          <a
            class="button secondary"
            href="${safeAndroidStore}"
          >
            Get it on Google Play
          </a>


          ${
            iosStoreUrl
              ? `
                <a
                  class="button secondary"
                  href="${safeIosStore}"
                >
                  Download on the App Store
                </a>
              `
              : ""
          }

        </div>


        <div class="footer">

          Run. Connect. Compete.<br/>
          Built for runners.

        </div>

      </div>

    </section>

  </main>


  <script>

    (function () {

      const appUrl =
        ${JSON.stringify(appUrl)};

      const storeUrl =
        ${JSON.stringify(automaticStoreUrl)};

      let timer;


      document.addEventListener(
        "visibilitychange",
        () => {

          if (
            document.visibilityState === "hidden"
          ) {

            clearTimeout(timer);

          }

        }
      );


      setTimeout(
        () => {

          window.location.href =
            appUrl;

        },
        150
      );


      if (storeUrl) {

        timer =
          setTimeout(
            () => {

              if (
                document.visibilityState ===
                "visible"
              ) {

                window.location.replace(
                  storeUrl
                );

              }

            },
            1800
          );

      }

    })();

  </script>

</body>

</html>
  `);
});

export default router;
