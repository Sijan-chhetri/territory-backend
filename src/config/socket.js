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
      console.log("SOCKET CONNECTED:", socket.id);

      socket.on("register_user", (userId) => {
        if (!userId) {
          console.log("REGISTER_USER FAILED: userId missing");
          return;
        }

        onlineUsers.set(userId, socket.id);

        console.log("USER REGISTERED:", {
          userId,
          socketId: socket.id,
          onlineUsersCount: onlineUsers.size,
        });
      });

      socket.on("disconnect", (reason) => {
        console.log("SOCKET DISCONNECTED:", {
          socketId: socket.id,
          reason,
        });

        for (const [userId, socketId] of onlineUsers.entries()) {
          if (socketId === socket.id) {
            onlineUsers.delete(userId);

            console.log("USER REMOVED FROM ONLINE USERS:", {
              userId,
              onlineUsersCount: onlineUsers.size,
            });

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
    console.log("SOCKET EMIT REQUEST:", {
      userId,
      event,
      payload,
    });

    if (!io) {
      console.log("SOCKET EMIT SKIPPED: io not initialized");
      return;
    }

    if (!userId) {
      console.log("SOCKET EMIT SKIPPED: userId missing");
      return;
    }

    if (!event) {
      console.log("SOCKET EMIT SKIPPED: event missing");
      return;
    }

    const socketId = onlineUsers.get(userId);

    if (!socketId) {
      console.log("SOCKET EMIT SKIPPED: user offline", {
        userId,
      });
      return;
    }

    io.to(socketId).emit(event, payload);

    console.log("SOCKET EVENT SENT:", {
      userId,
      socketId,
      event,
    });
  } catch (error) {
    console.error("SOCKET_EMIT_ERROR:", error.message);
  }
};

export const getOnlineUsers = () => {
  return Array.from(onlineUsers.entries()).map(([userId, socketId]) => ({
    userId,
    socketId,
  }));
};