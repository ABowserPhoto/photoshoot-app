import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BILLING_COMPANY_NAME,
  BILLING_FROM_NAME,
  BILLING_MAILBOX_EMAIL,
  billingFromHeader,
  billingReplyToHeader,
  draftEnvelopeForMailbox,
  formatMailboxHeader,
} from "./billingMailbox.ts";
import {
  buildFinalizeShootEmailPlainText,
  buildSeparateInvoiceEmailHtml,
  buildSeparateInvoiceEmailPlainText,
} from "./finalizeShootEmail.ts";
import { buildRawEmail } from "./google.ts";
import { generateInvoiceReminderEmail } from "./invoiceReminderAi.ts";

test("billing drafts impersonate the Rechnung mailbox and name Monie", () => {
  const envelope = draftEnvelopeForMailbox("billing", "aaron@aaronbowser-photography.com");
  assert.equal(envelope.subjectUser, BILLING_MAILBOX_EMAIL);
  assert.equal(envelope.from, `Monie <${BILLING_MAILBOX_EMAIL}>`);
  assert.equal(envelope.replyTo, BILLING_MAILBOX_EMAIL);
  assert.equal(billingFromHeader(), envelope.from);
  assert.equal(billingReplyToHeader(), BILLING_MAILBOX_EMAIL);
});

test("studio mailbox drafts stay on the workspace user with no billing reply-to", () => {
  const envelope = draftEnvelopeForMailbox("workspace", "aaron@aaronbowser-photography.com");
  assert.equal(envelope.subjectUser, "aaron@aaronbowser-photography.com");
  assert.equal(envelope.from, "aaron@aaronbowser-photography.com");
  assert.equal(envelope.replyTo, undefined);
});

test("billing reply-to is a header on the raw invoice message", () => {
  const raw = buildRawEmail({
    from: billingFromHeader(),
    to: "client@example.com",
    subject: "Invoice | Beispiel GmbH - RE-1 - 01.01.2026",
    htmlBody: "<p>Hallo</p>",
    plainTextFallback: "Hallo",
    replyTo: billingReplyToHeader(),
  });
  assert.match(raw, /^From: Monie <rechnung@aaronbowser-photography\.com>/m);
  assert.match(raw, /^Reply-To: rechnung@aaronbowser-photography\.com/m);
  assert.match(raw, /^To: client@example\.com/m);
});

test("mailbox display names that contain commas are quoted", () => {
  assert.equal(
    formatMailboxHeader("Bowser, Monie", BILLING_MAILBOX_EMAIL),
    `"Bowser, Monie" <${BILLING_MAILBOX_EMAIL}>`
  );
});

test("gallery delivery mail stays signed by the photographer", () => {
  const text = buildFinalizeShootEmailPlainText({
    googleDriveLink: "https://drive.google.com/drive/folders/abc",
    includeInvoiceNote: false,
  });
  assert.match(text, /Aaron Bowser/);
  assert.equal(text.includes(BILLING_MAILBOX_EMAIL), false);
  assert.equal(text.includes("Monie"), false);
});

test("invoice and reminder copy sign as Monie at the billing address", () => {
  const invoiceHtml = buildSeparateInvoiceEmailHtml({
    billingEntityName: "Beispiel GmbH",
    invoiceNumber: "RE-1",
  });
  const invoiceText = buildSeparateInvoiceEmailPlainText({
    billingEntityName: "Beispiel GmbH",
    invoiceNumber: "RE-1",
  });
  const reminder = generateInvoiceReminderEmail({
    invoiceNumber: "RE-1",
    clientName: "Beispiel GmbH",
    contactNameOrBusinessName: "Beispiel GmbH",
  });

  for (const body of [invoiceHtml, invoiceText, reminder.bodyPlain, reminder.bodyHtml]) {
    assert.match(body, new RegExp(BILLING_FROM_NAME));
    assert.match(body, new RegExp(BILLING_MAILBOX_EMAIL.replace(/[.]/g, "\\.")));
    assert.match(body, new RegExp(BILLING_COMPANY_NAME));
    assert.equal(body.includes("Aaron Bowser<br>"), false);
    assert.equal(body.includes("\nAaron Bowser\n"), false);
  }
});
