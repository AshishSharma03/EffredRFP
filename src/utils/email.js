import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER || 'info@effred.com',
    pass: process.env.SMTP_PASS || 'Info',
  },
});

export const verifyEmailConfig = async () => {
  try {
    await transporter.verify();
    console.log('✅ Email service configured');
    return true;
  } catch (error) {
    console.warn('⚠️  Email not configured:', error.message);
    return false;
  }
};

export const sendEmail = async ({ to, subject, text, html, from }) => {
  try {
    const info = await transporter.sendMail({
      from: from || process.env.SMTP_USER || 'info@effred.com',
      to,
      subject,
      text,
      html,
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Email error:', error.message);
    return { success: false, error: error.message };
  }
};

export const sendPasswordResetEmail = async (to, resetUrl, userName) => {
  return await sendEmail({
    to,
    subject: 'Password Reset - Effred RFP',
    html: `<p>Hi ${userName}, click <a href="${resetUrl}">here</a> to reset your password.</p>`,
  });
};

export const sendWelcomeEmail = async (to, userName) => {
  return await sendEmail({
    to,
    subject: 'Welcome to Effred RFP',
    html: `<p>Welcome ${userName}!</p>`,
  });
};

export const sendCompanyAdminCreatedEmail = async (to, adminName, companyName) => {
  return await sendEmail({
    to,
    subject: 'Admin Account Created',
    html: `<p>Hi ${adminName}, you are now admin of ${companyName}.</p>`,
  });
};

export const sendAccountStatusEmail = async (to, userName, status) => {
  return await sendEmail({
    to,
    subject: 'Account Status Updated',
    html: `<p>Hi ${userName}, your account is now ${status}.</p>`,
  });
};

export default {
  sendEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendCompanyAdminCreatedEmail,
  sendAccountStatusEmail,
  verifyEmailConfig,
};