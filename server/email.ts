// E-mail transacional opcional (recuperação de palavra-passe).
// ⚠️ DEPENDÊNCIA EXTERNA: conta Resend (plano gratuito) + RESEND_API_KEY + EMAIL_FROM com domínio verificado.
// Sem configuração, a recuperação por e-mail fica desativada e a UI diz isso (não finge que enviou).
export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export async function sendEmail(to: string, subject: string, text: string) {
  if (!emailConfigured()) throw new Error('email_nao_configurado');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, text }),
  });
  if (!r.ok) throw new Error(`email_falhou:${r.status}`);
}
