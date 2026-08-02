import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import http from "http";
import dns from "node:dns";

import { startClanMessageCleanupJob } from "./src/jobs/clanMessageCleanup.job.js";
import { initSocket } from "./src/config/socket.js";
import {
  verifyEmailTransporter,
} from "./src/config/emailTransporter.js";
import emailTransporter from "./src/config/emailTransporter.js";

import authRoutes from "./src/modules/auth/auth.routes.js";
import activityRoutes from "./src/modules/activity/activity.routes.js";
import territoryRoutes from "./src/modules/activity/territory.routes.js";
import progressionRoutes from "./src/modules/progression/progression.routes.js";
import xpRoutes from "./src/modules/xp/xp.routes.js";
import badgeRoutes from "./src/modules/badge/badge.routes.js";
import levelRoutes from "./src/modules/level/level.routes.js";
import friendRoutes from "./src/modules/friends/friend.routes.js";
import clanRoutes from "./src/modules/clan/clan.route.js";
import notificationRoutes from "./src/modules/notification/notification.route.js";
import leaderboardRoutes from "./src/modules/leaderboard/User/leaderboard.routes.js";
import clanLeaderboardRoutes from "./src/modules/leaderboard/Clan/clanLeaderboard.route.js";
import clanChatRoutes from "./src/modules/clanChat/clanChatRoutes.js";
import clubWarRoutes from "./src/modules/clubWar/clubWarRoutes.js";
import clanEventRoutes from "./src/modules/clanEvent/clanEvent.routes.js";
import deepLinkRoutes from "./src/modules/integration_examples/deepLink.routes.js";

dns.setDefaultResultOrder("ipv4first");

const app = express();
const server = http.createServer(app);

// ============================================================================
// GLOBAL MIDDLEWARE
// ============================================================================

app.use(cors());

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  }),
);

app.use(morgan("dev"));

app.use(
  express.json({
    limit: "50mb",
  }),
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "50mb",
  }),
);

// ============================================================================
// SOCKET.IO
// ============================================================================

initSocket(server);

// ============================================================================
// EMAIL SERVICE
// ============================================================================

// This already calls emailTransporter.verify() internally.
// Do not verify the transporter a second time.
verifyEmailTransporter();

// ============================================================================
// DEEP-LINK AND APP-LINK ROUTES
// ============================================================================
//
// IMPORTANT:
// This router must be mounted at "/" and not "/api".
//
// It provides routes such as:
//
// GET /.well-known/assetlinks.json
// GET /.well-known/apple-app-site-association
// GET /open/clan-event
//
// These routes must remain at the domain root.
//
app.use("/", deepLinkRoutes);

// ============================================================================
// ROOT HEALTH CHECK
// ============================================================================

app.get("/", (_req, res) => {
  return res.status(200).send("Territory Backend Running");
});

// ============================================================================
// EMAIL CONNECTION TEST
// ============================================================================

app.get("/api/test-email-connection", async (_req, res) => {
  try {
    await emailTransporter.verify();

    return res.status(200).json({
      success: true,
      message: "Email service connected successfully",
    });
  } catch (error) {
    console.error("EMAIL_CONNECTION_TEST_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Email service connection failed",
      error: error?.message || "Unknown email error",
      code: error?.code || null,
      command: error?.command || null,
      responseCode: error?.responseCode || null,
    });
  }
});

// ============================================================================
// API ROUTES
// ============================================================================

app.use("/api/auth", authRoutes);
app.use("/api/activities", activityRoutes);
app.use("/api/territories", territoryRoutes);
app.use("/api/progression", progressionRoutes);
app.use("/api/xp", xpRoutes);
app.use("/api/badges", badgeRoutes);
app.use("/api/levels", levelRoutes);
app.use("/api/friends", friendRoutes);
app.use("/api/clans", clanRoutes);
app.use("/api/notification", notificationRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/clan/leaderboard", clanLeaderboardRoutes);
app.use("/api/clan-chat", clanChatRoutes);
app.use("/api/clan-event", clanEventRoutes);
app.use("/api/club-wars", clubWarRoutes);

// ============================================================================
// 404 HANDLER
// ============================================================================
//
// Keep this below all root routes and API routes.
//
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ============================================================================
// GLOBAL ERROR HANDLER
// ============================================================================

app.use((error, _req, res, _next) => {
  console.error("UNHANDLED_SERVER_ERROR:", error);

  return res.status(error?.status || 500).json({
    success: false,
    message: error?.message || "Internal server error",
  });
});

// ============================================================================
// START SERVER
// ============================================================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startClanMessageCleanupJob();
});