import admin from "firebase-admin";

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export default admin;

// import "dotenv/config";
// import admin from "firebase-admin";
// import crypto from "crypto";

// const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
// const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
// const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;

// if (!projectId) {
//   throw new Error("FIREBASE_PROJECT_ID is missing from .env");
// }

// if (!clientEmail) {
//   throw new Error("FIREBASE_CLIENT_EMAIL is missing from .env");
// }

// if (!rawPrivateKey) {
//   throw new Error("FIREBASE_PRIVATE_KEY is missing from .env");
// }

// // Convert escaped \n characters to real line breaks.
// // Also remove Windows \r characters and accidental whitespace.
// const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(
//   /\\n/g,
//   "\n",
// ).trim();

// console.log("🔥 Firebase configuration");
// console.log("Project:", projectId);
// console.log("Client email:", clientEmail);

// console.log(
//   "Private key BEGIN valid:",
//   privateKey.startsWith("-----BEGIN PRIVATE KEY-----"),
// );

// console.log(
//   "Private key END valid:",
//   privateKey.endsWith("-----END PRIVATE KEY-----"),
// );

// // Validate the key with Node before passing it to Firebase.
// // This gives a clearer error if the .env value is malformed.
// try {
//   crypto.createPrivateKey({
//     key: privateKey,
//     format: "pem",
//   });

//   console.log("✅ Firebase private key is valid PEM");
// } catch (error) {
//   console.error("❌ Firebase private key is malformed.");
//   console.error(error.message);

//   console.error(
//     "Check FIREBASE_PRIVATE_KEY in .env. It must contain exactly one BEGIN PRIVATE KEY and one END PRIVATE KEY.",
//   );

//   throw error;
// }

// if (!admin.apps.length) {
//   admin.initializeApp({
//     credential: admin.credential.cert({
//       projectId,
//       clientEmail,
//       privateKey,
//     }),
//   });

//   console.log("✅ Firebase Admin initialized successfully");
// }

// export default admin;
