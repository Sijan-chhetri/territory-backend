// utils/templates/clanEventInvitation.template.js

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const formatEventDate = (date) => {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kathmandu",
    timeZoneName: "short",
  }).format(new Date(date));
};

export const clanEventInvitationTemplate = ({
  memberName,
  clanName,
  eventTitle,
  eventDescription,
  eventLocation,
  startsAt,
  endsAt,
  createdByName,
  joinUrl,
}) => {
  const safeMemberName = escapeHtml(memberName || "Duro Athlete");
  const safeClanName = escapeHtml(clanName);
  const safeEventTitle = escapeHtml(eventTitle);
  const safeDescription = escapeHtml(
    eventDescription || "Your clan has created a new event."
  );
  const safeLocation = escapeHtml(
    eventLocation || "Location will be announced"
  );
  const safeCreator = escapeHtml(createdByName || "Your clan leader");

  const formattedStart = formatEventDate(startsAt);
  const formattedEnd = formatEventDate(endsAt);

  return {
    subject: `${safeClanName} invited you to ${safeEventTitle} | Duro`,

    text: `
Hi ${memberName || "Duro Athlete"},

${createdByName || "Your clan leader"} has invited you to join a new event organized by ${clanName}.

Event: ${eventTitle}
Date: ${formattedStart}
Ends: ${formattedEnd}
Location: ${eventLocation || "Location will be announced"}

${eventDescription || ""}

Join the event:
${joinUrl}

Keep moving,
The Duro Team
    `.trim(),

    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />

  <title>${safeEventTitle}</title>
</head>

<body
  style="
    margin: 0;
    padding: 0;
    background-color: #f3f5f7;
    font-family: Arial, Helvetica, sans-serif;
    color: #15171a;
  "
>
  <table
    role="presentation"
    width="100%"
    cellspacing="0"
    cellpadding="0"
    border="0"
    style="background-color: #f3f5f7; padding: 32px 12px;"
  >
    <tr>
      <td align="center">

        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="
            max-width: 620px;
            background-color: #ffffff;
            border-radius: 24px;
            overflow: hidden;
            box-shadow: 0 16px 45px rgba(20, 30, 40, 0.10);
          "
        >

          <!-- Header -->
          <tr>
            <td
              style="
                padding: 30px 34px;
                background: linear-gradient(
                  135deg,
                  #101418 0%,
                  #1f2925 55%,
                  #b7ff3c 150%
                );
              "
            >
              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
              >
                <tr>
                  <td>
                    ${
                      process.env.DURO_LOGO_URL
                        ? `
                        <img
                          src="${process.env.DURO_LOGO_URL}"
                          alt="Duro"
                          width="110"
                          style="
                            display: block;
                            max-width: 110px;
                            height: auto;
                          "
                        />
                      `
                        : `
                        <div
                          style="
                            color: #ffffff;
                            font-size: 30px;
                            font-weight: 900;
                            letter-spacing: 3px;
                          "
                        >
                          DURO
                        </div>
                      `
                    }
                  </td>

                  <td align="right">
                    <span
                      style="
                        display: inline-block;
                        padding: 8px 13px;
                        border-radius: 999px;
                        background-color: #b7ff3c;
                        color: #101418;
                        font-size: 12px;
                        font-weight: 800;
                        letter-spacing: 0.8px;
                      "
                    >
                      CLAN EVENT
                    </span>
                  </td>
                </tr>
              </table>

              <div
                style="
                  margin-top: 30px;
                  color: #b7ff3c;
                  font-size: 13px;
                  font-weight: 700;
                  letter-spacing: 1.5px;
                  text-transform: uppercase;
                "
              >
                ${safeClanName}
              </div>

              <h1
                style="
                  margin: 10px 0 8px;
                  color: #ffffff;
                  font-size: 34px;
                  line-height: 1.18;
                  font-weight: 800;
                "
              >
                ${safeEventTitle}
              </h1>

              <p
                style="
                  margin: 0;
                  color: #cfd6d2;
                  font-size: 16px;
                  line-height: 1.6;
                "
              >
                Your clan is gathering. Your next challenge is ready.
              </p>
            </td>
          </tr>

          <!-- Main content -->
          <tr>
            <td style="padding: 36px 34px 18px;">
              <p
                style="
                  margin: 0 0 18px;
                  font-size: 17px;
                  line-height: 1.7;
                "
              >
                Hi <strong>${safeMemberName}</strong>,
              </p>

              <p
                style="
                  margin: 0 0 25px;
                  color: #4a5158;
                  font-size: 16px;
                  line-height: 1.7;
                "
              >
                <strong>${safeCreator}</strong> has invited you to join a
                new event organized by
                <strong>${safeClanName}</strong>.
              </p>

              <!-- Event card -->
              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
                style="
                  background-color: #f6f8f7;
                  border: 1px solid #e4e9e6;
                  border-radius: 18px;
                "
              >
                <tr>
                  <td style="padding: 24px;">

                    <table
                      role="presentation"
                      width="100%"
                      cellspacing="0"
                      cellpadding="0"
                      border="0"
                    >
                      <tr>
                        <td
                          valign="top"
                          width="34"
                          style="font-size: 21px;"
                        >
                          📅
                        </td>

                        <td style="padding-bottom: 17px;">
                          <div
                            style="
                              color: #6a7278;
                              font-size: 12px;
                              font-weight: 700;
                              text-transform: uppercase;
                              letter-spacing: 1px;
                            "
                          >
                            Starts
                          </div>

                          <div
                            style="
                              margin-top: 5px;
                              color: #15171a;
                              font-size: 15px;
                              font-weight: 700;
                              line-height: 1.5;
                            "
                          >
                            ${formattedStart}
                          </div>
                        </td>
                      </tr>

                      <tr>
                        <td
                          valign="top"
                          width="34"
                          style="font-size: 21px;"
                        >
                          🏁
                        </td>

                        <td style="padding-bottom: 17px;">
                          <div
                            style="
                              color: #6a7278;
                              font-size: 12px;
                              font-weight: 700;
                              text-transform: uppercase;
                              letter-spacing: 1px;
                            "
                          >
                            Ends
                          </div>

                          <div
                            style="
                              margin-top: 5px;
                              color: #15171a;
                              font-size: 15px;
                              font-weight: 700;
                              line-height: 1.5;
                            "
                          >
                            ${formattedEnd}
                          </div>
                        </td>
                      </tr>

                      <tr>
                        <td
                          valign="top"
                          width="34"
                          style="font-size: 21px;"
                        >
                          📍
                        </td>

                        <td>
                          <div
                            style="
                              color: #6a7278;
                              font-size: 12px;
                              font-weight: 700;
                              text-transform: uppercase;
                              letter-spacing: 1px;
                            "
                          >
                            Location
                          </div>

                          <div
                            style="
                              margin-top: 5px;
                              color: #15171a;
                              font-size: 15px;
                              font-weight: 700;
                              line-height: 1.5;
                            "
                          >
                            ${safeLocation}
                          </div>
                        </td>
                      </tr>
                    </table>

                  </td>
                </tr>
              </table>

              <div
                style="
                  margin-top: 24px;
                  padding: 20px;
                  border-left: 4px solid #b7ff3c;
                  background-color: #fbfcfb;
                  color: #4a5158;
                  font-size: 15px;
                  line-height: 1.7;
                "
              >
                ${safeDescription}
              </div>

              <!-- CTA button -->
              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
                style="margin-top: 30px;"
              >
                <tr>
                  <td align="center">
                    <a
                      href="${joinUrl}"
                      style="
                        display: inline-block;
                        min-width: 220px;
                        padding: 16px 26px;
                        background-color: #b7ff3c;
                        color: #101418;
                        text-decoration: none;
                        border-radius: 14px;
                        font-size: 16px;
                        font-weight: 800;
                        text-align: center;
                      "
                    >
                      View & Join Event →
                    </a>
                  </td>
                </tr>
              </table>

              <p
                style="
                  margin: 25px 0 0;
                  color: #7b8287;
                  font-size: 13px;
                  line-height: 1.6;
                  text-align: center;
                "
              >
                This invitation is available only to members of
                ${safeClanName}.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td
              style="
                padding: 28px 34px;
                background-color: #101418;
                text-align: center;
              "
            >
              <div
                style="
                  color: #b7ff3c;
                  font-size: 19px;
                  font-weight: 900;
                  letter-spacing: 2px;
                "
              >
                DURO
              </div>

              <p
                style="
                  margin: 10px 0 0;
                  color: #aab3ae;
                  font-size: 13px;
                  line-height: 1.6;
                "
              >
                Move together. Compete together. Grow stronger.
              </p>

              <p
                style="
                  margin: 14px 0 0;
                  color: #747d78;
                  font-size: 11px;
                  line-height: 1.5;
                "
              >
                You received this email because you are a member of
                ${safeClanName} on Duro.
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>
    `.trim(),
  };
};