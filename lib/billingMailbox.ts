/**
 * Client invoice and dunning mail.
 * Drafts are created in this mailbox (a separate Google Workspace user), not as a send-as alias.
 */
export const BILLING_MAILBOX_EMAIL = "rechnung@aaronbowser-photography.com";
export const BILLING_FROM_NAME = "Monie";
export const BILLING_COMPANY_NAME = "Aaron Bowser Photography";

export type GmailDraftMailbox = "workspace" | "billing";

export type GmailDraftEnvelope = {
  /** Workspace user the service account impersonates (`JWT` subject). */
  subjectUser: string;
  from: string;
  replyTo?: string;
};

/** `Name <addr>` suitable for a MIME From header. Name and address must already be single-line. */
export function formatMailboxHeader(displayName: string, email: string): string {
  const name = displayName.replace(/[\r\n]+/g, " ").trim();
  const address = email.replace(/[\r\n<>]+/g, "").trim();
  if (!name) {
    return address;
  }
  const quoted = /[",]/.test(name) ? `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : name;
  return `${quoted} <${address}>`;
}

export function billingFromHeader(): string {
  return formatMailboxHeader(BILLING_FROM_NAME, BILLING_MAILBOX_EMAIL);
}

export function billingReplyToHeader(): string {
  return BILLING_MAILBOX_EMAIL;
}

export function billingSignaturePlainLines(): readonly string[] {
  return [BILLING_FROM_NAME, BILLING_COMPANY_NAME, BILLING_MAILBOX_EMAIL];
}

export function billingSignatureHtml(): string {
  return [
    BILLING_FROM_NAME,
    BILLING_COMPANY_NAME,
    `<a href="mailto:${BILLING_MAILBOX_EMAIL}">${BILLING_MAILBOX_EMAIL}</a>`,
  ].join("<br>\n    ");
}

/**
 * From / Reply-To / impersonated user for a draft.
 * `workspaceUserEmail` is `GOOGLE_WORKSPACE_USER_EMAIL` (gallery, previews, Drive).
 * Billing always impersonates the Rechnung mailbox, even when that env var is a different user.
 */
export function draftEnvelopeForMailbox(
  mailbox: GmailDraftMailbox,
  workspaceUserEmail: string
): GmailDraftEnvelope {
  switch (mailbox) {
    case "workspace":
      return { subjectUser: workspaceUserEmail, from: workspaceUserEmail };
    case "billing":
      return {
        subjectUser: BILLING_MAILBOX_EMAIL,
        from: billingFromHeader(),
        replyTo: billingReplyToHeader(),
      };
    default: {
      const unreachable: never = mailbox;
      throw new Error(`Unsupported Gmail mailbox: ${String(unreachable)}`);
    }
  }
}
