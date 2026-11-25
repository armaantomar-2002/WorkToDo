'use strict';

/**
 * Email provider abstraction. Only two providers exist:
 *  - "console": DEVELOPMENT ONLY. Prints the message (including password-reset links) to the server log. Nothing is delivered.
 *  - "none":    sends nothing and logs that no provider is configured.
 * No real delivery provider (SMTP, SES, ...) is implemented; add one behind this interface to deliver real email.
 * `delivered` is always false, and callers/docs must never claim delivery.
 */
function createEmailProvider(config, logger = console) {
  const useConsole = config.email.provider === 'console' && !config.isProduction;
  return {
    name: useConsole ? 'console' : 'none',
    async send({ to, subject, text }) {
      if (useConsole) logger.info(`[email:console] NOT DELIVERED (development provider)\n  To: ${to}\n  Subject: ${subject}\n  ${text.split('\n').join('\n  ')}`);
      else logger.warn('[email] No email provider configured; message was not sent');
      return { delivered: false };
    },
  };
}

module.exports = { createEmailProvider };
