import cron from 'node-cron';
import prisma from '../config/prisma.js';

const CHAT_RETENTION_DAYS = 7;

/**
 * Delete every clan message older than seven days.
 */
export const cleanupOldClanMessages = async () => {
  try {
    const cutoffDate = new Date(
      Date.now() - CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    const result = await prisma.clanMessage.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    });

    console.log('==========================================');
    console.log('CLAN CHAT CLEANUP COMPLETED');
    console.log(`Deleted messages: ${result.count}`);
    console.log(`Deleted before: ${cutoffDate.toISOString()}`);
    console.log('==========================================');

    return result.count;
  } catch (error) {
    console.error('CLAN_CHAT_CLEANUP_ERROR:', error);
    return 0;
  }
};

/**
 * Start the automatic clan-message cleanup scheduler.
 */
export const startClanMessageCleanupJob = () => {
  // Clean expired messages whenever the server starts.
  // This handles messages that expired while the server was offline.
  cleanupOldClanMessages().catch((error) => {
    console.error('INITIAL_CLAN_CHAT_CLEANUP_ERROR:', error);
  });

  // Run every day at 3:00 AM Nepal time.
  cron.schedule(
    '20 14 * * *',
    async () => {
      await cleanupOldClanMessages();
    },
    {
      name: 'clan-message-cleanup',
      timezone: 'Asia/Kathmandu',
      noOverlap: true,
    },
  );

  console.log(
    'Clan message cleanup scheduled daily at 2:20 PM Nepal time',
  );
};