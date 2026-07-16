import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import http from "http";

import dns from "node:dns";

dns.setDefaultResultOrder("ipv4first");


import { initSocket } from "./src/config/socket.js";

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
import clanleaderboardRoutes from "./src/modules/leaderboard/Clan/clanLeaderboard.route.js";
import clanChatRoutes from "./src/modules/clanChat/clanChatRoutes.js"
import clubWarRoutes from "./src/modules/clubWar/clubWarRoutes.js";
import clanEventRoutes from "./src/modules/clanEvent/clanEvent.routes.js";

import { verifyEmailTransporter } from "./src/config/emailTransporter.js";
import emailTransporter from "./src/config/emailTransporter.js";



const app = express();

app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());

const server = http.createServer(app);

initSocket(server);
verifyEmailTransporter();


emailTransporter
  .verify()
  .then(() => {
    console.log("GMAIL_TRANSPORTER_READY");
  })
  .catch((error) => {
    console.error("GMAIL_TRANSPORTER_VERIFY_ERROR:", error);
  });

app.get("/", (_, res) => {
  res.send("Territory Backend Running");
});



app.get("/api/test-email-connection", async (_, res) => {
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
      error: error.message,
      code: error.code,
      command: error.command,
      responseCode: error.responseCode,
    });
  }
});

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
app.use("/api/clan/leaderboard", clanleaderboardRoutes);
app.use('/api/clan-chat', clanChatRoutes);
app.use('/api/clan-event', clanEventRoutes);

app.use('/api/club-wars',clubWarRoutes)

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});