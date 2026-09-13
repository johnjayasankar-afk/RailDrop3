import { Resend } from "resend";
import { getConfig } from "@/lib/config";
import type { Mailer, MailerResult } from "./send-alert";

export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey = getConfig().resendApiKey,
    private readonly from = getConfig().resendFrom,
  ) {}

  async send(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<MailerResult> {
    if (!this.apiKey || !this.from) {
      return {
        status: "FAILED",
        providerMessageId: null,
        errorMessage: "RESEND_API_KEY or RESEND_FROM is not configured",
      };
    }
    try {
      const resend = new Resend(this.apiKey);
      const result = await resend.emails.send({
        from: this.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
      if (result.error) {
        return {
          status: "FAILED",
          providerMessageId: null,
          errorMessage: result.error.message,
        };
      }
      return {
        status: "ACCEPTED",
        providerMessageId: result.data?.id ?? null,
        errorMessage: null,
      };
    } catch (error) {
      return {
        status: "FAILED",
        providerMessageId: null,
        errorMessage: error instanceof Error ? error.message : "Resend send failed",
      };
    }
  }
}

export class RecordingMailer implements Mailer {
  sent: Array<{ to: string; subject: string; html: string; text: string }> = [];
  failNext = false;

  async send(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<MailerResult> {
    if (this.failNext) {
      this.failNext = false;
      return { status: "FAILED", providerMessageId: null, errorMessage: "forced failure" };
    }
    this.sent.push(input);
    return { status: "ACCEPTED", providerMessageId: `msg_${this.sent.length}`, errorMessage: null };
  }
}
