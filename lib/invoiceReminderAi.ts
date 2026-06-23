export type InvoiceReminderEmailDraft = {
  subject: string;
  bodyPlain: string;
  bodyHtml: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function plainTextToHtml(text: string): string {
  const paragraphs = text
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return "<p></p>";
  }

  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

const INVOICE_REMINDER_IMAGE_URL =
  "https://res.cloudinary.com/dggils0xr/image/upload/v1782084423/zahlungserinnerung_ggoqcw.png";

export function buildInvoiceReminderEmailHtml(generatedEmailText: string): string {
  const bodyText = escapeHtml(generatedEmailText.trim());

  return `<html>
<head></head>
<body>
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
    <h2 style="text-align: center; color: #222;">Zahlungserinnerung</h2>

    <img src="${INVOICE_REMINDER_IMAGE_URL}" alt="Zahlungserinnerung" style="width: 100%; max-width: 600px; height: auto; display: block; margin: 20px auto; border-radius: 8px;" />

    <div style="font-size: 16px; line-height: 1.5; white-space: pre-wrap;">
      ${bodyText}
    </div>
  </div>
</body>
</html>`;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      const parsed = JSON.parse(match[0]) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

export async function generateInvoiceReminderEmail(input: {
  invoiceNumber: string;
  shootName: string;
  clientName: string;
  companyName: string;
  daysOverdue: number;
}): Promise<InvoiceReminderEmailDraft> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const invoiceLabel = input.invoiceNumber.trim() || "Rechnung";
  const shootLabel = input.shootName.trim() || "Ihr Fotoshooting";
  const clientLabel = input.clientName.trim() || input.companyName.trim() || "Kunde";

  const systemPrompt =
    "Du bist ein professioneller Fotograf in NRW. Schreibe kurze, freundliche Geschäftsmails auf Deutsch. " +
    "Sei höflich, klar und unaufdringlich. Keine Markdown-Formatierung.";

  const userPrompt =
    `Schreibe eine kurze Zahlungserinnerung für ${clientLabel}. ` +
    `Die Rechnung ${invoiceLabel} für das Fotoshooting "${shootLabel}" ist seit ${input.daysOverdue} Tagen überfällig. ` +
    "Bitte erwähne die Rechnung und bitte höflich um zeitnahe Begleichung. " +
    'Antworte NUR als JSON-Objekt: {"subject":"...","body":"..."}';

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.6,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI request failed (${response.status}): ${detail || response.statusText}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) {
    throw new Error("OpenAI returned an empty reminder draft.");
  }

  const parsed = parseJsonObject(content);
  const subject =
    typeof parsed?.subject === "string" && parsed.subject.trim()
      ? parsed.subject.trim()
      : `Zahlungserinnerung: Rechnung ${invoiceLabel}`;
  const bodyPlain =
    typeof parsed?.body === "string" && parsed.body.trim()
      ? parsed.body.trim()
      : content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  return {
    subject,
    bodyPlain,
    bodyHtml: buildInvoiceReminderEmailHtml(bodyPlain),
  };
}
