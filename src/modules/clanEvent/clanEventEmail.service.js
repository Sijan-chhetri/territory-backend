// services/clanEventEmail.service.js

import emailTransporter from "../../config/emailTransporter.js";
import { buildClanEventDeepLink } from "../../config/clanEventDeepLink.js";
import { clanEventInvitationTemplate } from "../../config/templates/clanEventInvitation.template.js";

export const sendClanEventInvitations = async ({
  event,
  clan,
  creator,
  members,
}) => {
  const eligibleMembers = members.filter((member) => {
    const email = member.user?.email?.trim();
    const memberUserId = String(member.userId || member.user?.id || "");
    const creatorId = String(creator?.id || "");

    return email && memberUserId !== creatorId;
  });

  if (eligibleMembers.length === 0) {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      successful: [],
      failures: [],
    };
  }

  const invitationTasks = eligibleMembers.map(async (member) => {
    const user = member.user;

    // This URL opens DURO directly when installed.
    // Otherwise, the backend deep-link page handles the store fallback.
    const joinUrl = buildClanEventDeepLink({
      clanId: clan.id,
      eventId: event.id,
    });

    const template = clanEventInvitationTemplate({
      memberName:
        user.fullName?.trim() ||
        user.username?.trim() ||
        "Duro Athlete",

      clanName: clan.name,
      eventTitle: event.title,
      eventDescription: event.description,
      eventLocation: event.location,
      startsAt: event.startsAt,
      endsAt: event.endsAt,

      createdByName:
        creator?.fullName?.trim() ||
        creator?.username?.trim() ||
        event.createdBy?.fullName?.trim() ||
        event.createdBy?.username?.trim() ||
        "Your club leader",

      joinUrl,
    });

    const info = await emailTransporter.sendMail({
      from: {
        name: "Duro",
        address: process.env.GMAIL_USER,
      },

      to: user.email.trim(),
      subject: template.subject,
      text: template.text,
      html: template.html,

      replyTo:
        process.env.DURO_SUPPORT_EMAIL ||
        process.env.GMAIL_USER,

      headers: {
        "X-Duro-Notification-Type":
          "CLAN_EVENT_INVITATION",

        "X-Duro-Event-Id": String(event.id),
        "X-Duro-Clan-Id": String(clan.id),
      },
    });

    return {
      userId: member.userId || user.id,
      email: user.email.trim(),
      messageId: info.messageId,
    };
  });

  const results = await Promise.allSettled(invitationTasks);

  const successful = [];
  const failures = [];

  results.forEach((result, index) => {
    const member = eligibleMembers[index];
    const user = member.user;

    if (result.status === "fulfilled") {
      successful.push(result.value);
      return;
    }

    failures.push({
      userId: member.userId || user?.id,
      email: user?.email || null,
      error:
        result.reason?.message ||
        String(result.reason || "Unknown email error"),
    });
  });

  return {
    attempted: eligibleMembers.length,
    sent: successful.length,
    failed: failures.length,
    successful,
    failures,
  };
};