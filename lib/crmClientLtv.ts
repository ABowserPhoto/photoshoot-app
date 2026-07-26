type LineItemRow = { quantity?: unknown; price?: unknown };

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

function parseLineItems(value: unknown): LineItemRow[] {
  return Array.isArray(value) ? (value as LineItemRow[]) : [];
}

function sumLineItems(items: LineItemRow[]): number {
  return items.reduce((sum, item) => sum + toNumber(item.quantity) * toNumber(item.price), 0);
}

export function computeTaskInvoiceNet(row: Record<string, unknown>): number {
  const services = parseLineItems(row.services);
  const products = parseLineItems(row.products);
  const subtotal = sumLineItems(services) + sumLineItems(products);
  const discount = toNumber(row.discount);
  const taxRate = toNumber(row.tax_percentage) / 100;
  const amountType = String(row.amount_type ?? "Net").toLowerCase();
  const adjusted = Math.max(0, subtotal - discount);

  if (amountType === "gross") {
    return taxRate > 0 ? adjusted / (1 + taxRate) : adjusted;
  }
  return adjusted;
}

export function normalizeCompanyKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function isTaskEligibleForLtv(row: Record<string, unknown>): boolean {
  if (row.is_paid === true || row.credit_note_paid === true) {
    return true;
  }
  const status = String(row.status ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  return status === "completed" || status.includes("completed");
}

export function computeTaskLtvAmount(row: Record<string, unknown>): number {
  if (!isTaskEligibleForLtv(row)) {
    return 0;
  }
  const expectedRevenue = toNumber(row.expected_revenue);
  if (expectedRevenue > 0) {
    return expectedRevenue;
  }
  return computeTaskInvoiceNet(row);
}

export function buildCompanyLtvMap(tasks: Record<string, unknown>[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const task of tasks) {
    const companyKey = normalizeCompanyKey(
      typeof task.company_name === "string" ? task.company_name : typeof task.client === "string" ? task.client : ""
    );
    if (!companyKey) {
      continue;
    }
    const amount = computeTaskLtvAmount(task);
    if (amount <= 0) {
      continue;
    }
    totals.set(companyKey, (totals.get(companyKey) ?? 0) + amount);
  }
  return totals;
}
