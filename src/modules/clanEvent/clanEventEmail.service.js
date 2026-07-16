// services/clanEventEmail.service.js

import emailTransporter from "../../config/emailTransporter.js";
import { clanEventInvitationTemplate } from "../../config/templates/clanEventInvitation.template.js";

export const sendClanEventInvitations = async ({
  event,
  clan,
  creator,
  members,
}) => {
  const eligibleMembers = members.filter(
    (member) =>
      member.user?.email &&
      member.userId !== creator.id
  );

  if (eligibleMembers.length === 0) {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      failures: [],
    };
  }

  const invitationTasks = eligibleMembers.map(async (member) => {
    const joinUrl =
      `${process.env.DURO_APP_URL}/clan-events/${event.id}`;

    const template = clanEventInvitationTemplate({
      memberName:
        member.user.fullName ||
        member.user.username,

      clanName: clan.name,
      eventTitle: event.title,
      eventDescription: event.description,
      eventLocation: event.location,
      startsAt: event.startsAt,
      endsAt: event.endsAt,

      createdByName:
        creator.fullName ||
        creator.username,

      joinUrl,
    });

    const info = await emailTransporter.sendMail({
      from: {
        name: "Duro",
        address: process.env.GMAIL_USER,
      },

      to: member.user.email,
      subject: template.subject,
      text: template.text,
      html: template.html,

      replyTo:
        process.env.DURO_SUPPORT_EMAIL ||
        process.env.GMAIL_USER,

      headers: {
        "X-Duro-Notification-Type":
          "CLAN_EVENT_INVITATION",

        "X-Duro-Event-Id": event.id,
        "X-Duro-Clan-Id": clan.id,
      },
    });

    return {
      userId: member.userId,
      email: member.user.email,
      messageId: info.messageId,
    };
  });

  const results = await Promise.allSettled(invitationTasks);

  const successful = [];
  const failures = [];

  results.forEach((result, index) => {
    const member = eligibleMembers[index];

    if (result.status === "fulfilled") {
      successful.push(result.value);
    } else {
      failures.push({
        userId: member.userId,
        email: member.user.email,
        error:
          result.reason?.message ||
          "Unknown email error",
      });
    }
  });

  return {
    attempted: eligibleMembers.length,
    sent: successful.length,
    failed: failures.length,
    successful,
    failures,
  };
};