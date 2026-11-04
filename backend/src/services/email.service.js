// Sending email goes through a provider with one method: send({ to, cc, subject, html, text, replyTo, fromName }).
//   "console"  logs the email instead of sending it (the default while developing, and in the tests)
//   "brevo"    sends it with the Brevo transactional email API (free tier, needs a verified sender address)
// EMAIL_PROVIDER chooses. Anything that goes wrong becomes an EmailError, which callers turn into a friendly message.

export class EmailError extends Error {}

// What the console provider "sent", newest last, so the tests (and curious developers) can look at it
const outbox = [];
export const getSentEmails = () => outbox;
export const clearSentEmails = () => {
  outbox.length = 0;
};

const toList = (value) => (Array.isArray(value) ? value : value ? [value] : []);

const consoleProvider = {
  name: 'console',
  async send(email) {
    outbox.push({ ...email, to: toList(email.to), cc: toList(email.cc), at: new Date() });
    if (process.env.NODE_ENV !== 'test') {
      console.log(
        ['', '---------- email (console provider: nothing was sent) ----------', `To:       ${toList(email.to).join(', ')}`, ...(toList(email.cc).length ? [`Cc:       ${toList(email.cc).join(', ')}`] : []), `Subject:  ${email.subject}`, '', email.text, '----------------------------------------------------------------', ''].join('\n')
      );
    }
  },
};

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

const brevoProvider = {
  name: 'brevo',
  async send({ to, cc, subject, html, text, replyTo, fromName }) {
    const apiKey = process.env.BREVO_API_KEY;
    const fromEmail = process.env.EMAIL_FROM;
    if (!apiKey || !fromEmail) {
      throw new EmailError('The brevo provider needs BREVO_API_KEY and EMAIL_FROM');
    }

    const people = (list) => toList(list).map((email) => ({ email }));
    const response = await fetch(BREVO_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        sender: { name: fromName || process.env.EMAIL_FROM_NAME || 'TimeLedger', email: fromEmail },
        to: people(to),
        ...(toList(cc).length > 0 && { cc: people(cc) }),
        ...(replyTo && { replyTo }),
        subject,
        htmlContent: html,
        textContent: text,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new EmailError(`Brevo answered ${response.status}: ${detail.slice(0, 300)}`);
    }
  },
};

// Lets a test swap in its own provider (for example one that always fails). Pass null to go back to EMAIL_PROVIDER.
let override = null;
export const setEmailProvider = (provider) => {
  override = provider;
};

const chooseProvider = () => {
  if (override) return override;

  const name = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
  if (name === 'console') return consoleProvider;
  if (name === 'brevo') return brevoProvider;
  if (name) throw new EmailError(`Unknown EMAIL_PROVIDER "${name}" (use console or brevo)`);

  // Not set: fine while developing, but in production an email that is only logged would look like it was sent
  if (process.env.NODE_ENV === 'production') {
    throw new EmailError('EMAIL_PROVIDER is not set');
  }
  return consoleProvider;
};

export const sendEmail = async (email) => {
  try {
    await chooseProvider().send(email);
  } catch (err) {
    throw err instanceof EmailError ? err : new EmailError(err.message);
  }
};
