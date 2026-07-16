// utils/templates/passwordResetOtp.template.js

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export const passwordResetOtpTemplate = ({
  fullName,
  otp,
}) => {
  const safeName = escapeHtml(fullName || "Duro Athlete");

  return {
    subject: "Reset your Duro password",

    text: `
Hi ${fullName || "Duro Athlete"},

Your Duro password-reset code is:

${otp}

This code expires in 5 minutes.

You have a maximum of 3 verification attempts. If you did not request this password reset, you can safely ignore this email.

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

  <title>Reset your Duro password</title>
</head>

<body
  style="
    margin: 0;
    padding: 0;
    background-color: #f2f4f3;
    font-family: Arial, Helvetica, sans-serif;
    color: #131715;
  "
>
  <table
    role="presentation"
    width="100%"
    cellspacing="0"
    cellpadding="0"
    border="0"
    style="padding: 32px 14px; background-color: #f2f4f3;"
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
            max-width: 580px;
            background-color: #ffffff;
            border-radius: 24px;
            overflow: hidden;
            box-shadow: 0 14px 40px rgba(15, 25, 20, 0.10);
          "
        >

          <tr>
            <td
              style="
                padding: 32px;
                background-color: #111614;
                text-align: center;
              "
            >
              <div
                style="
                  color: #b7ff3c;
                  font-size: 32px;
                  font-weight: 900;
                  letter-spacing: 4px;
                "
              >
                DURO
              </div>

              <div
                style="
                  margin-top: 10px;
                  color: #d6ddd8;
                  font-size: 14px;
                "
              >
                Password Recovery
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding: 36px 34px;">

              <h1
                style="
                  margin: 0 0 18px;
                  color: #131715;
                  font-size: 28px;
                  line-height: 1.25;
                "
              >
                Reset your password
              </h1>

              <p
                style="
                  margin: 0 0 18px;
                  color: #505853;
                  font-size: 16px;
                  line-height: 1.7;
                "
              >
                Hi <strong>${safeName}</strong>,
              </p>

              <p
                style="
                  margin: 0;
                  color: #505853;
                  font-size: 16px;
                  line-height: 1.7;
                "
              >
                Use the following verification code to reset your
                Duro password.
              </p>

              <div
                style="
                  margin: 28px 0;
                  padding: 22px;
                  background-color: #f4f8ef;
                  border: 2px solid #b7ff3c;
                  border-radius: 18px;
                  text-align: center;
                "
              >
                <div
                  style="
                    color: #747c77;
                    font-size: 12px;
                    font-weight: 700;
                    letter-spacing: 1.5px;
                    text-transform: uppercase;
                  "
                >
                  Verification code
                </div>

                <div
                  style="
                    margin-top: 10px;
                    color: #101512;
                    font-size: 38px;
                    font-weight: 900;
                    letter-spacing: 10px;
                  "
                >
                  ${otp}
                </div>
              </div>

              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
                style="
                  background-color: #f7f8f7;
                  border-radius: 14px;
                "
              >
                <tr>
                  <td
                    style="
                      padding: 18px;
                      color: #535b56;
                      font-size: 14px;
                      line-height: 1.7;
                    "
                  >
                    ⏱ This code expires in
                    <strong>5 minutes</strong>.<br />

                    🔐 You have a maximum of
                    <strong>3 verification attempts</strong>.
                  </td>
                </tr>
              </table>

              <p
                style="
                  margin: 24px 0 0;
                  color: #747c77;
                  font-size: 13px;
                  line-height: 1.7;
                "
              >
                If you did not request a password reset, you can
                safely ignore this message. Your password will not
                change unless the code is verified.
              </p>
            </td>
          </tr>

          <tr>
            <td
              style="
                padding: 24px 32px;
                background-color: #111614;
                text-align: center;
              "
            >
              <div
                style="
                  color: #b7ff3c;
                  font-size: 17px;
                  font-weight: 900;
                  letter-spacing: 2px;
                "
              >
                DURO
              </div>

              <p
                style="
                  margin: 8px 0 0;
                  color: #9ca69f;
                  font-size: 12px;
                "
              >
                Move stronger. Stay secure.
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