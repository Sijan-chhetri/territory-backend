import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import http from "http";
import { initSocket } from "./config/socket.js";

import authRoutes        from './modules/auth/auth.routes.js';
import activityRoutes    from './modules/activity/activity.routes.js';
import territoryRoutes   from './modules/activity/territory.routes.js';
import progressionRoutes from './modules/progression/progression.routes.js';
import xpRoutes          from './modules/xp/xp.routes.js';
import badgeRoutes       from './modules/badge/badge.routes.js';
import levelRoutes       from './modules/level/level.routes.js';
import friendRoutes      from './modules/friends/friend.routes.js';
import clanRoutes        from './modules/clan/clan.route.js';
import notificationRoutes from "./modules/notification/notification.route.js"
import leaderboardRoutes from "./modules/leaderboard/leaderboard.routes.js";

const app = express();


app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

const server = http.createServer(app);

initSocket(server);

app.get('/', (_, res) => res.send('Territory Backend Running'));

app.use('/api/auth',        authRoutes);
app.use('/api/activities',  activityRoutes);
app.use('/api/territories', territoryRoutes);
app.use('/api/progression', progressionRoutes);
app.use('/api/xp',          xpRoutes);
app.use('/api/badges',      badgeRoutes);
app.use('/api/levels',      levelRoutes);
app.use('/api/friends',     friendRoutes);
app.use('/api/clans',       clanRoutes);
app.use('/api/notification',       notificationRoutes);
app.use("/api/leaderboard", leaderboardRoutes);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
