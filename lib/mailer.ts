import nodemailer from 'nodemailer'

let transporter: nodemailer.Transporter | null = null

function getTransporter() {
  if (transporter) return transporter
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
  return transporter
}

const ROLE_LABEL: Record<string, string> = {
  senior_officer: 'Senior Officer',
  executive_officer: 'Executive Officer',
}

export async function sendInvitationEmail(opts: {
  to: string
  role: 'senior_officer' | 'executive_officer'
  identificationCode: string
  jurisdictionCity?: string | null
}) {
  const { to, role, identificationCode, jurisdictionCity } = opts
  const roleLabel = ROLE_LABEL[role] || role
  const appUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'

  await getTransporter().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: `Congratulations — you've been hired as a ${roleLabel} on NiyamAI`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
        <h2>Congratulations!</h2>
        <p>You've been brought onto NiyamAI as a <b>${roleLabel}</b> for your enforcement team.</p>
        <p>Create your account below and enter this identification code when prompted:</p>
        <div style="background:#f1f5f9; border-radius:8px; padding:16px; text-align:center; margin:16px 0;">
          <span style="font-size:20px; letter-spacing:2px; font-weight:700;">${identificationCode}</span>
        </div>
        <p>You'll need this exact code both to finish signing up and every time you sign in afterward (including with Google) — keep it safe.</p>
        <p><a href="${appUrl}/signup" style="color:#2563eb;">Create your account →</a></p>
        <p style="color:#64748b; font-size:12px; margin-top:24px;">If you weren't expecting this, you can ignore this email.</p>
      </div>
    `,
  })
}

export async function sendCompanyApprovedEmail(opts: {
  to: string
  companyName: string
  apiKey: string
}) {
  const { to, companyName, apiKey } = opts
  const appUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'

  await getTransporter().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: `${companyName} has been approved on NiyamAI`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
        <h2>You're approved!</h2>
        <p><b>${companyName}</b> has been approved as a Compliance Head account on NiyamAI.</p>
        <p>Use this API key along with your email and password every time you log in:</p>
        <div style="background:#f1f5f9; border-radius:8px; padding:16px; text-align:center; margin:16px 0;">
          <span style="font-size:16px; letter-spacing:1px; font-weight:700; word-break:break-all;">${apiKey}</span>
        </div>
        <p>Keep this key confidential — treat it like a password.</p>
        <p><a href="${appUrl}/login" style="color:#2563eb;">Log in →</a></p>
      </div>
    `,
  })
}

export async function sendCompanyRejectedEmail(opts: {
  to: string
  companyName: string
  reason?: string | null
}) {
  const { to, companyName, reason } = opts

  await getTransporter().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: `Update on your NiyamAI request for ${companyName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
        <h2>Request not approved</h2>
        <p>Your request to register <b>${companyName}</b> as a Compliance Head account on NiyamAI was not approved.</p>
        ${reason ? `<p><b>Reason:</b> ${reason}</p>` : ''}
        <p style="color:#64748b; font-size:12px; margin-top:24px;">If you believe this is a mistake, please contact our team.</p>
      </div>
    `,
  })
}
export async function sendManagerInvitationEmail(opts: {
  to: string
  managerName: string
  companyName: string
  productName: string
  apiKey: string
}) {
  const { to, managerName, companyName, productName, apiKey } = opts
  const appUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'

  await getTransporter().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: `You've been added as Product Manager for ${productName} at ${companyName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
        <h2>Welcome, ${managerName}!</h2>
        <p><b>${companyName}</b> has added you as the Product Manager for <b>${productName}</b> on NiyamAI.</p>
        <p>Paste this API key on the login page to access your product panel — no separate password needed:</p>
        <div style="background:#f1f5f9; border-radius:8px; padding:16px; text-align:center; margin:16px 0;">
          <span style="font-size:16px; letter-spacing:1px; font-weight:700; word-break:break-all;">${apiKey}</span>
        </div>
        <p>Keep this key confidential — treat it like a password.</p>
        <p><a href="${appUrl}/login" style="color:#2563eb;">Go to login →</a></p>
      </div>
    `,
  })
}