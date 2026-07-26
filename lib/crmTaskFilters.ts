const CRM_EXCLUDED_KEYWORDS = ["tester", "blocker", "test"] as const;

function fieldContainsExcludedKeyword(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return CRM_EXCLUDED_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Tasks eligible for the CRM credit-note unpaid billing list. */
export function isCrmEligibleCreditNoteBillingTask(row: Record<string, unknown>): boolean {
  if (toNumber(row.expected_revenue) <= 0) {
    return false;
  }
  // Paid credit notes (legacy is_paid or new credit_note_paid) leave the unpaid list.
  if (row.credit_note_paid === true || row.is_paid === true) {
    return false;
  }
  return true;
}

/** Exclude CRM billing rows whose title, client label, or company name looks like test data. */
export function isCrmExcludedBillingTask(row: Record<string, unknown>): boolean {
  return (
    isCrmExcludedBillingLabel(row.title) ||
    isCrmExcludedBillingLabel(row.client) ||
    isCrmExcludedBillingLabel(row.company_name)
  );
}

export function isCrmExcludedBillingLabel(value: unknown): boolean {
  return fieldContainsExcludedKeyword(value);
}
