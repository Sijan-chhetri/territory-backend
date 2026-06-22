import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import http from "http";

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


const app = express();

app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());

const server = http.createServer(app);

initSocket(server);

app.get("/", (_, res) => {
  res.send("Territory Backend Running");
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

app.unsubscribe('/api/club-wars',clubWarRoutes)

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});