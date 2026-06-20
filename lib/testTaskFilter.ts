const TEST_TASK_PATTERN = /\btest\b/i;

function fieldLooksLikeTest(value: unknown): boolean {
  return typeof value === "string" && TEST_TASK_PATTERN.test(value.trim());
}

/** Exclude deliberate test bookings without matching names like "Tester". */
export function isTestTaskRow(row: Record<string, unknown>): boolean {
  return (
    fieldLooksLikeTest(row.title) ||
    fieldLooksLikeTest(row.company_name) ||
    fieldLooksLikeTest(row.client)
  );
}
