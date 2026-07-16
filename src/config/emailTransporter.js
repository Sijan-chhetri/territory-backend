// config/emailTransporter.js

import nodemailer from "nodemailer";

const emailTransporter = nodemailer.createTransport({
  service: "gmail",

  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
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