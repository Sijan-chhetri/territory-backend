// config/emailTransporter.js

import nodemailer from "nodemailer";

const emailTransporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,

  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },

  family: 4,

  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 30000,
});





export const verifyEmailTransporter = async () => {
  try {
    await emailTransporter.verify();
    console.log("DURO_EMAIL_SERVICE_READY");
  } catch (error) {
    console.error("DURO_EMAIL_SERVICE_ERROR:", error);
  }
};

export default emailTransporter;