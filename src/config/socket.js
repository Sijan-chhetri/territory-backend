import { Server } from "socket.io";

let io = null;
const onlineUsers = new Map();

export const initSocket = (server) => {
  try {
    io = new Server(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST", "PATCH", "DELETE"],
      },
    });

    io.on("connection", (socket) => {
      socket.on("register_user", (userId) => {
        if (!userId) return;
        onlineUsers.set(userId, socket.id);
      });

      socket.on("disconnect", () => {
        for (const [userId, socketId] of onlineUsers.entries()) {
          if (socketId === socket.id) {
            onlineUsers.delete(userId);
            break;
          }
        }
      });
    });

    console.log("Socket.IO running");
  } catch (error) {
    console.error("SOCKET_INIT_ERROR:", error.message);
  }
};

export const emitToUser = (userId, event, payload) => {
  try {
    if (!io || !userId || !event) return;

    const socketId = onlineUsers.get(userId);

    if (!socketId) return;

    io.to(socketId).emit(event, payload);
  } catch (error) {
    console.error("SOCKET_EMIT_ERROR:", error.message);
  }
};