import type { gmail_v1 } from "googleapis";

const GMAIL_USER = "me";

export const LEXOFFICE_PROCESSED_LABEL = "Lexoffice/Processed";

export async function ensureLexofficeProcessedLabel(gmail: gmail_v1.Gmail): Promise<string> {
  const listResponse = await gmail.users.labels.list({ userId: GMAIL_USER });
  const existing = (listResponse.data.labels ?? []).find(
    (label) => label.name === LEXOFFICE_PROCESSED_LABEL && typeof label.id === "string"
  );
  if (existing?.id) {
    return existing.id;
  }

  const created = await gmail.users.labels.create({
    userId: GMAIL_USER,
    requestBody: {
      name: LEXOFFICE_PROCESSED_LABEL,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });

  const labelId = created.data.id?.trim();
  if (!labelId) {
    throw new Error(`Could not create Gmail label "${LEXOFFICE_PROCESSED_LABEL}".`);
  }

  return labelId;
}

export function messageHasProcessedLabel(
  message: gmail_v1.Schema$Message,
  processedLabelId: string
): boolean {
  return (message.labelIds ?? []).includes(processedLabelId);
}

export async function applyLexofficeProcessedLabel(
  gmail: gmail_v1.Gmail,
  messageId: string,
  processedLabelId: string
): Promise<void> {
  await gmail.users.messages.modify({
    userId: GMAIL_USER,
    id: messageId,
    requestBody: {
      addLabelIds: [processedLabelId],
    },
  });
}
