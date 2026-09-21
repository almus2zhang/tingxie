const nodemailer = require('nodemailer');

// Helper: Get or create SMTP transporter using environment variables
function getTransporter() {
  const user = process.env.QQ_USER || process.env.SMTP_USER || '';
  const pass = process.env.QQ_PASS || process.env.SMTP_PASS || '';

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.qq.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: true, // SSL
    auth: {
      user,
      pass,
    },
  });
}

/**
 * Send 6-digit verification code email
 * @param {string} toEmail - Recipient email address
 * @param {string} code - 6-digit code
 * @param {string} type - 'register' | 'reset'
 */
async function sendVerificationCodeEmail(toEmail, code, type = 'register') {
  const isRegister = type === 'register';
  const subject = isRegister 
    ? '【单词听写兼记忆】注册验证码' 
    : '【单词听写兼记忆】账号验证码';

  const html = `
    <div style="max-width: 520px; margin: 0 auto; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; border-radius: 16px; border: 1px solid #e2e8f0;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #4f46e5; margin: 0; font-size: 22px; font-weight: 800;">单词听写兼记忆网站</h2>
        <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">权威真人发音 · AI 智能识别 · 录音打分</p>
      </div>

      <div style="background-color: #ffffff; padding: 28px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); text-align: center;">
        <p style="color: #334155; font-size: 15px; margin: 0 0 16px 0;">
          您正在进行${isRegister ? '新用户账号注册' : '账号验证'}，您的验证码为：
        </p>

        <div style="display: inline-block; background: #eef2ff; border: 2px dashed #6366f1; border-radius: 10px; padding: 12px 32px; margin-bottom: 16px;">
          <span style="font-size: 32px; font-weight: 900; letter-spacing: 6px; color: #4338ca; font-family: monospace;">${code}</span>
        </div>

        <p style="color: #64748b; font-size: 12px; margin: 0; line-height: 1.6;">
          验证码有效时间为 <strong>10 分钟</strong>。<br>
          如非本人操作，请忽略此邮件，切勿将验证码泄露给他人。
        </p>
      </div>

      <div style="text-align: center; margin-top: 20px;">
        <p style="color: #94a3b8; font-size: 11px; margin: 0;">此邮件由系统自动发送，请勿直接回复。</p>
      </div>
    </div>
  `;

  const user = process.env.QQ_USER || process.env.SMTP_USER || '';
  const pass = process.env.QQ_PASS || process.env.SMTP_PASS || '';

  if (!user || !pass) {
    throw new Error('未配置发信邮箱凭据，请在项目根目录 .env 中配置 QQ_USER 与 QQ_PASS');
  }

  const transporter = getTransporter();
  const info = await transporter.sendMail({
    from: `"单词听写平台" <${user}>`,
    to: toEmail,
    subject,
    html,
  });

  return info;
}

module.exports = {
  sendVerificationCodeEmail,
};
