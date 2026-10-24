// Password-reset emails go through Resend (https://resend.com) when RESEND_API_KEY and MAIL_FROM are set.
// Without them the site still works; students ask the organizer, who sets a temporary password in the cabinet.

export const mailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

export async function sendMail({ to, subject, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
