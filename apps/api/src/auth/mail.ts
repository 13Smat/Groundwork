import nodemailer from "nodemailer";

import { readSmtp } from "../config.js";

type MailLogger = {
  info(obj: Record<string, unknown>, message: string): void;
};

export type OutboundMail = {
  to: string;
  subject: string;
  text: string;
};

export type Mailer = {
  send(mail: OutboundMail): Promise<void>;
};

/**
 * Mailpit receives local SMTP. With no SMTP host, development logs the message
 * (the magic link or invite URL) and production refuses to pretend it was sent.
 */
export function createMailer(logger: MailLogger): Mailer {
  const smtp = readSmtp();
  return {
    async send(mail) {
      if (smtp) {
        const transport = nodemailer.createTransport({
          host: smtp.host,
          port: smtp.port,
          secure: false,
        });
        await transport.sendMail({
          from: "Groundwork <noreply@localhost>",
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
        });
        return;
      }
      if (process.env.NODE_ENV === "production") {
        throw new Error("SMTP_HOST is required to send mail when NODE_ENV is production.");
      }
      logger.info(
        { to: mail.to, subject: mail.subject, text: mail.text },
        "mail kept on the console",
      );
    },
  };
}
