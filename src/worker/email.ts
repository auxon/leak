export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  text: string,
): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject,
      text,
    }),
  });
  if (!sent.ok) {
    console.error(JSON.stringify({ msg: "resend_failed", status: sent.status }));
    return false;
  }
  return true;
}
