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

export default router;
