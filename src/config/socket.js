import { Server } from "socket.io";
import prisma from "./prisma.js";

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

      // Existing user register
      socket.on("register_user", async (userId) => {
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

        // Auto join user's clan room after register
        try {
          const membership = await prisma.clanMember.findFirst({
            where: { userId },
          });

          if (membership) {
            socket.join(`clan:${membership.clanId}`);

            console.log("USER JOINED CLAN ROOM:", {
              userId,
              clanId: membership.clanId,
              room: `clan:${membership.clanId}`,
            });

            socket.emit("clan:joined", {
              clanId: membership.clanId,
            });
          }
        } catch (error) {
          console.error("AUTO_JOIN_CLAN_ERROR:", error.message);
        }
      });

      // Send clan message
      socket.on("clan:message:send", async ({ userId, message }) => {
        try {
          if (!userId) {
            return socket.emit("clan:error", {
              message: "User ID missing",
            });
          }

          if (!message || message.trim().length === 0) {
            return socket.emit("clan:error", {
              message: "Message cannot be empty",
            });
          }

          const cleanMessage = message.trim();

          if (cleanMessage.length > 1000) {
            return socket.emit("clan:error", {
              message: "Message is too long",
            });
          }

          const membership = await prisma.clanMember.findFirst({
            where: { userId },
          });

          if (!membership) {
            return socket.emit("clan:error", {
              message: "You are not in a clan",
            });
          }

          const savedMessage = await prisma.clanMessage.create({
            data: {
              clanId: membership.clanId,
              senderId: userId,
              message: cleanMessage,
            },
            include: {
              sender: {
                select: {
                  id: true,
                  username: true,
                  fullName: true,
                },
              },
            },
          });

          io.to(`clan:${membership.clanId}`).emit(
            "clan:message:new",
            savedMessage
          );

          console.log("CLAN MESSAGE SENT:", {
            clanId: membership.clanId,
            senderId: userId,
            messageId: savedMessage.id,
          });
        } catch (error) {
          console.error("CLAN_MESSAGE_SEND_ERROR:", error.message);

          socket.emit("clan:error", {
            message: "Failed to send message",
          });
        }
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