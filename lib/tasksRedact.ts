import type { UserRole } from "@/lib/authRole";
import { isAdminRole } from "@/lib/authRole";

/** Row shape from tasks.select(...) — loose for JSON compatibility */
export type TaskRow = Record<string, unknown>;

/**
 * Removes client PII and invoice/commercial fields for non-admin responses.
 */
export function redactTaskRowForRole(row: TaskRow, role: UserRole): TaskRow {
  if (isAdminRole(role)) {
    return row;
  }
  return {
    ...row,
    company_name: null,
    lexoffice_contact_id: null,
    contact_first_name: null,
    contact_last_name: null,
    email: null,
    phone: null,
    street: null,
    zip_code: null,
    city: null,
    country: null,
    services: [],
    products: [],
    tax_percentage: null,
    amount_type: null,
    discount: null,
  };
}
