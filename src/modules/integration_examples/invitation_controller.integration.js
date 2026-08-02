// In the controller/service that sends the clan-event invitation email:

import { buildClanEventDeepLink } from "../../config/clanEventDeepLink.js"
import { clanEventInvitationTemplate } from "../../config/templates/clanEventInvitation.template.js";

// `event` and `clan` are examples; use your existing queried records.
const joinUrl = buildClanEventDeepLink({
  clanId: clan.id,
});

const email = clanEventInvitationTemplate({
  memberName: member.fullName || member.username,
  clanName: clan.name,
  eventTitle: event.title,
  eventDescription: event.description,
  eventLocation: event.location,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  createdByName:
    event.createdBy?.fullName ||
    event.createdBy?.username ||
    "Your club leader",
  joinUrl,
});

// Send using your existing mail service:
// await sendEmail({
//   to: member.email,
//   subject: email.subject,
//   text: email.text,
//   html: email.html,
// });
