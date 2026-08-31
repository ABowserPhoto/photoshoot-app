"use client";

import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import Select, { type ActionMeta, type ClassNamesConfig, type SingleValue } from "react-select";
import CreatableSelect from "react-select/creatable";
import KanbanBoard, { type BoardTask } from "./components/KanbanBoard";
import StatsSidebar from "./components/StatsSidebar";
import CreditNoteUploadModal from "@/app/components/CreditNoteUploadModal";
import UploadDeliverablesModal from "@/app/components/UploadDeliverablesModal";
import GlobalNavButtons from "@/app/components/GlobalNavButtons";
import GlobalLogoutControl from "@/app/components/GlobalLogoutControl";
import JibbleClockToggle from "@/app/components/JibbleClockToggle";
import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import { PERMISSION_DENIED_QUERY } from "@/lib/permissionDenied";
import { updateTaskStatus } from "@/app/actions/tasks";
import { supabase } from "@/lib/supabaseClient";
import { buildFinalizeShootPayload } from "@/lib/finalizeShootPayload";
import { uploadSocialDeliverableFiles } from "@/lib/socialDeliverableUpload";

type AmountType = "Net" | "Gross";
type PhotoshootType =
  | "Immobilien"
  | "Business Portraits"
  | "Food"
  | "Product"
  | "Portrait Pro"
  | "Studio Portrait"
  | "Hochzeit"
  | "Mini Session"
  | "Event";
type ItemType = "Service" | "Product";
type PreviewPreference = "first" | "middle" | "last";

function splitContactPerson(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: "", lastName: "" };
  }
  if (parts.length === 1) {
    return { firstName: "", lastName: parts[0] };
  }
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

type LineItem = {
  name: string;
  quantity: number;
  price: number;
  lexoffice_id: string | null;
};

type Client = {
  id: string;
  company_name: string | null;
  street: string | null;
  zip_code: string | null;
  city: string | null;
  country?: string | null;
  address_supplement?: string | null;
  billing_street?: string | null;
  billing_city?: string | null;
  billing_postal_code?: string | null;
  billing_country?: string | null;
  email?: string | null;
  phone?: string | null;
  lexoffice_contact_id: string | null;
};

type CatalogItem = {
  id: string;
  item_type: string;
  name: string;
  default_price: number;
  lexoffice_id: string | null;
};

type SelectOption = {
  value: string;
  label: string;
};

type ClientDirectoryEntry = {
  id: string | null;
  company_name: string;
  street: string;
  zip_code: string;
  city: string;
  country: string;
  address_supplement: string;
  email: string;
  phone: string;
  lexoffice_contact_id: string;
};

type ClientNameOption = SelectOption & {
  client: ClientDirectoryEntry | null;
};

type CrmContactDirectoryEntry = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  companyId: string;
  companyName: string;
  lexofficeContactId: string;
  billingStreet: string;
  billingCity: string;
  billingPostalCode: string;
  billingCountry: string;
  primaryEmail: string;
  ccEmails: string[];
};

type ContactPersonOption = SelectOption & {
  contact: CrmContactDirectoryEntry | null;
};

type CatalogOption = SelectOption & {
  name: string;
  defaultPrice: number;
  lexoffice_id: string | null;
};

/** Fields sent to Supabase `tasks` insert/update (matches DB column names). */
type TaskSupabasePayload = {
  company_name: string;
  contact_first_name: string;
  contact_last_name: string;
  contact_id: string | null;
  street: string;
  zip_code: string;
  city: string;
  lexoffice_contact_id: string | null;
  country: string;
  address_supplement: string;
  email: string;
  email_cc: string | null;
  gallery_link: string | null;
  has_separate_invoice_email: boolean;
  invoice_email_address: string | null;
  phone: string;
  services: Array<{ name: string; quantity: number; price: number; lexoffice_id: string | null }>;
  products: Array<{ name: string; quantity: number; price: number; lexoffice_id: string | null }>;
  services_lexoffice_id: string[];
  products_lexoffice_id: string[];
  tax_percentage: number;
  amount_type: AmountType;
  discount: number;
  photoshoot_type: PhotoshootType;
  shoot_location: string;
  photoshoot_date: string;
  preview_preference: PreviewPreference;
  due_date: string | null;
  status: string;
  title: string;
  client: string;
  skip_invoice: boolean;
  generate_gallery: boolean;
  is_credit_note: boolean;
  expected_revenue: number;
  is_paid: boolean;
  credit_note_paid: boolean;
  credit_note_file_url: string | null;
  linked_item_id: string | null;
  local_open_path: string | null;
};

const selectStyles = {
  control: (base: Record<string, unknown>, state: { isFocused: boolean }) => ({
    ...base,
    minHeight: 40,
    borderRadius: 10,
    borderColor: state.isFocused ? "#27272a" : "#d4d4d8",
    backgroundColor: "#ffffff",
    boxShadow: state.isFocused ? "0 0 0 2px #a1a1aa" : "none",
    "&:hover": { borderColor: "#27272a" },
  }),
  menu: (base: Record<string, unknown>) => ({
    ...base,
    backgroundColor: "#18181b",
    border: "1px solid #3f3f46",
    borderRadius: 10,
    overflow: "hidden",
    zIndex: 40,
  }),
  option: (base: Record<string, unknown>, state: { isFocused: boolean; isSelected: boolean }) => ({
    ...base,
    backgroundColor: state.isSelected ? "#27272a" : state.isFocused ? "#3f3f46" : "#18181b",
    color: "#fafafa",
    cursor: "pointer",
  }),
  singleValue: (base: Record<string, unknown>) => ({
    ...base,
    color: "#09090b",
  }),
  placeholder: (base: Record<string, unknown>) => ({
    ...base,
    color: "#71717a",
  }),
  input: (base: Record<string, unknown>) => ({
    ...base,
    color: "#09090b",
  }),
  indicatorSeparator: (base: Record<string, unknown>) => ({
    ...base,
    backgroundColor: "#d4d4d8",
  }),
  dropdownIndicator: (base: Record<string, unknown>, state: { isFocused: boolean }) => ({
    ...base,
    color: state.isFocused ? "#27272a" : "#71717a",
    "&:hover": { color: "#27272a" },
  }),
  clearIndicator: (base: Record<string, unknown>) => ({
    ...base,
    color: "#71717a",
    "&:hover": { color: "#27272a" },
  }),
  menuList: (base: Record<string, unknown>) => ({
    ...base,
    paddingTop: 4,
    paddingBottom: 4,
  }),
};

const clientNameSelectClassNames: ClassNamesConfig<ClientNameOption, false> = {
  control: (state) =>
    [
      "mt-1 min-h-10 rounded-lg border bg-white px-1 text-sm text-zinc-900 transition",
      "dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100",
      state.isFocused ? "border-zinc-500 ring-2 ring-zinc-400 dark:border-zinc-500" : "border-zinc-300",
    ].join(" "),
  valueContainer: () => "px-2 py-1",
  placeholder: () => "text-zinc-500 dark:text-zinc-400",
  singleValue: () => "text-zinc-900 dark:text-zinc-100",
  input: () => "text-zinc-900 dark:text-zinc-100",
  indicatorsContainer: () => "text-zinc-500",
  indicatorSeparator: () => "bg-zinc-300 dark:bg-zinc-700",
  dropdownIndicator: () => "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
  clearIndicator: () => "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
  menu: () =>
    "z-40 mt-1 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900",
  menuList: () => "py-1",
  option: (state) =>
    [
      "cursor-pointer px-3 py-2 text-sm",
      state.isSelected
        ? "bg-zinc-900 text-white dark:bg-zinc-200 dark:text-zinc-900"
        : "text-zinc-900 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800",
    ].join(" "),
};

const normalizeClientName = (value: string) => value.trim().toLowerCase();

function ensureSingleTrailingEmptyRow(items: LineItem[]): LineItem[] {
  const normalized = [...items];

  while (
    normalized.length > 1 &&
    normalized[normalized.length - 1].name === "" &&
    normalized[normalized.length - 2].name === ""
  ) {
    normalized.pop();
  }

  if (normalized[normalized.length - 1].name !== "") {
    normalized.push({ name: "", quantity: 1, price: 0, lexoffice_id: null });
  }

  return normalized;
}

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showArchiveView, setShowArchiveView] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [accessNotice, setAccessNotice] = useState<string | null>(null);
  const [clientDirectory, setClientDirectory] = useState<ClientDirectoryEntry[]>([]);
  const [crmContacts, setCrmContacts] = useState<CrmContactDirectoryEntry[]>([]);
  const [serviceCatalog, setServiceCatalog] = useState<CatalogItem[]>([]);
  const [productCatalog, setProductCatalog] = useState<CatalogItem[]>([]);
  const [saveAsNewClient, setSaveAsNewClient] = useState(false);
  const [saveToClientAddressBook, setSaveToClientAddressBook] = useState(false);
  const [showCatalogModal, setShowCatalogModal] = useState(false);
  const [newCatalogType, setNewCatalogType] = useState<ItemType>("Service");
  const [newCatalogName, setNewCatalogName] = useState("");
  const [newCatalogPrice, setNewCatalogPrice] = useState(0);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTask, setUploadTask] = useState<BoardTask | null>(null);
  const [allBoardTasks, setAllBoardTasks] = useState<BoardTask[]>([]);
  const [linkedItemId, setLinkedItemId] = useState<string | null>(null);
  const [localOpenPath, setLocalOpenPath] = useState("");
  const [softwareToast, setSoftwareToast] = useState<{ message: string; isError: boolean } | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [contactPerson, setContactPerson] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [street, setStreet] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [city, setCity] = useState("");
  const [addressSupplement, setAddressSupplement] = useState("");
  const [lexofficeContactId, setLexofficeContactId] = useState("");
  const [country, setCountry] = useState("");
  const [email, setEmail] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [galleryLink, setGalleryLink] = useState("");
  const [hasSeparateInvoiceEmail, setHasSeparateInvoiceEmail] = useState(false);
  const [invoiceEmailAddress, setInvoiceEmailAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [services, setServices] = useState<LineItem[]>([{ name: "", quantity: 1, price: 0, lexoffice_id: null }]);
  const [products, setProducts] = useState<LineItem[]>([{ name: "", quantity: 1, price: 0, lexoffice_id: null }]);
  const [taxPercentage, setTaxPercentage] = useState(19);
  const [amountType, setAmountType] = useState<AmountType>("Net");
  const [photoshootType, setPhotoshootType] = useState<PhotoshootType>("Immobilien");
  const [generateGallery, setGenerateGallery] = useState(true);
  const [shootLocation, setShootLocation] = useState("");
  const [photoshootDate, setPhotoshootDate] = useState("");
  const [previewPreference, setPreviewPreference] = useState<PreviewPreference>("first");
  const [dueDate, setDueDate] = useState("");
  const [discount, setDiscount] = useState(0);
  const [skipInvoice, setSkipInvoice] = useState(false);
  const [isCreditNote, setIsCreditNote] = useState(false);
  const [expectedRevenue, setExpectedRevenue] = useState(0);
  const [isPaid, setIsPaid] = useState(false);
  const [creditNotePaid, setCreditNotePaid] = useState(false);
  const [creditNoteFileUrl, setCreditNoteFileUrl] = useState("");
  const [isCreditNoteUploadOpen, setIsCreditNoteUploadOpen] = useState(false);
  const [creditNoteToast, setCreditNoteToast] = useState<string | null>(null);
  const [currentTaskStatus, setCurrentTaskStatus] = useState<BoardTask["status"]>("booking");
  const [localFolderNameDisplay, setLocalFolderNameDisplay] = useState("");
  const [openSections, setOpenSections] = useState({
    client: true,
    invoice: false,
    info: false,
  });
  const { authenticated, isAdmin, isLoading: authRoleLoading } = useAuthRole();
  const [preservedTaskTitle, setPreservedTaskTitle] = useState("");
  const invoiceTotals = useMemo(() => {
    const validServices = services.filter((item) => item.name.trim() !== "");
    const validProducts = products.filter((item) => item.name.trim() !== "");
    const serviceSubtotal = validServices.reduce((sum, item) => {
      const quantity = Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 0;
      const price = Number.isFinite(Number(item.price)) ? Number(item.price) : 0;
      return sum + quantity * price;
    }, 0);
    const productSubtotal = validProducts.reduce((sum, item) => {
      const quantity = Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 0;
      const price = Number.isFinite(Number(item.price)) ? Number(item.price) : 0;
      return sum + quantity * price;
    }, 0);
    const safeDiscount = Number.isFinite(Number(discount)) ? Number(discount) : 0;
    const safeTaxPercentage = Number.isFinite(Number(taxPercentage)) ? Number(taxPercentage) : 0;
    const taxRate = safeTaxPercentage / 100;
    const adjusted = Math.max(0, serviceSubtotal + productSubtotal - safeDiscount);

    if (amountType === "Gross") {
      // Line prices are gross: reverse-calculate net and tax from the gross total.
      const totalGross = adjusted;
      const totalNet = taxRate > 0 ? totalGross / (1 + taxRate) : totalGross;
      const totalTax = Math.max(0, totalGross - totalNet);
      return { totalNet, totalTax, totalGross };
    }

    const totalNet = adjusted;
    const totalTax = totalNet * taxRate;
    const totalGross = totalNet + totalTax;
    return { totalNet, totalTax, totalGross };
  }, [services, products, discount, taxPercentage, amountType]);
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    []
  );

  useEffect(() => {
    if (authRoleLoading) {
      return;
    }
    if (!isAdmin) {
      setOpenSections({ client: false, invoice: false, info: true });
    }
  }, [authRoleLoading, isAdmin]);

  const clientNameOptions: ClientNameOption[] = clientDirectory.map((client) => ({
    value: client.company_name,
    label: client.company_name,
    client,
  }));
  const selectedClientNameOption = useMemo<ClientNameOption | null>(() => {
    const trimmedName = companyName.trim();
    if (!trimmedName) {
      return null;
    }
    const existingOption = clientNameOptions.find(
      (option) => normalizeClientName(option.label) === normalizeClientName(trimmedName)
    );
    return existingOption ?? { value: trimmedName, label: trimmedName, client: null };
  }, [clientNameOptions, companyName]);

  const contactPersonOptions: ContactPersonOption[] = useMemo(() => {
    const companyFilterId = selectedClientId;
    const companyFilterName = companyName.trim().toLowerCase();
    const filtered = crmContacts.filter((contact) => {
      if (!companyFilterId && !companyFilterName) {
        return true;
      }
      if (companyFilterId && contact.companyId === companyFilterId) {
        return true;
      }
      if (
        companyFilterName &&
        contact.companyName.trim().toLowerCase() === companyFilterName
      ) {
        return true;
      }
      return false;
    });

    return filtered.map((contact) => ({
      value: contact.id,
      label:
        companyFilterId || companyFilterName
          ? contact.fullName
          : contact.companyName
            ? `${contact.fullName} — ${contact.companyName}`
            : contact.fullName,
      contact,
    }));
  }, [crmContacts, selectedClientId, companyName]);
  const selectedContactOption = useMemo<ContactPersonOption | null>(() => {
    if (selectedContactId) {
      const byId = contactPersonOptions.find((option) => option.value === selectedContactId);
      if (byId) return byId;
      // Selected contact may be filtered out when another business is chosen.
      const fromDirectory = crmContacts.find((contact) => contact.id === selectedContactId);
      if (fromDirectory) {
        return {
          value: fromDirectory.id,
          label: fromDirectory.fullName,
          contact: fromDirectory,
        };
      }
    }
    const trimmed = contactPerson.trim();
    if (!trimmed) return null;
    const byName = contactPersonOptions.find(
      (option) =>
        option.contact &&
        option.contact.fullName.toLowerCase() === trimmed.toLowerCase() &&
        (!companyName.trim() ||
          option.contact.companyName.toLowerCase() === companyName.trim().toLowerCase())
    );
    return byName ?? { value: trimmed, label: trimmed, contact: null };
  }, [contactPersonOptions, selectedContactId, contactPerson, companyName, crmContacts]);

  // Resolve client id once directory loads (e.g. opening an edit booking).
  useEffect(() => {
    const trimmed = companyName.trim();
    if (!trimmed) {
      return;
    }
    const match = clientDirectory.find(
      (client) => normalizeClientName(client.company_name) === normalizeClientName(trimmed)
    );
    if (match?.id && match.id !== selectedClientId) {
      setSelectedClientId(match.id);
    }
  }, [clientDirectory, companyName, selectedClientId]);
  const serviceOptions: CatalogOption[] = serviceCatalog.map((item) => ({
    value: item.id,
    label: item.name,
    name: item.name,
    defaultPrice: item.default_price,
    lexoffice_id: item.lexoffice_id,
  }));
  const productOptions: CatalogOption[] = productCatalog.map((item) => ({
    value: item.id,
    label: item.name,
    name: item.name,
    defaultPrice: item.default_price,
    lexoffice_id: item.lexoffice_id,
  }));
  const initialClientsLoad = useRef<Promise<void> | null>(null);

  const taskClientDisplayLabel = (task: BoardTask) =>
    task.companyName.trim() ||
    [task.contactFirstName, task.contactLastName].filter(Boolean).join(" ").trim() ||
    "";

  const getTaskTitle = (task: BoardTask) =>
    [task.photoshootType, taskClientDisplayLabel(task), task.shootLocation].filter(Boolean).join(" - ") || "Untitled";

  const calculateTaskPrice = (task: BoardTask) => {
    const safeServices = Array.isArray(task.services) ? task.services : [];
    const safeProducts = Array.isArray(task.products) ? task.products : [];
    const serviceTotal = safeServices.reduce((sum, row) => sum + row.quantity * row.price, 0);
    const productTotal = safeProducts.reduce((sum, row) => sum + row.quantity * row.price, 0);
    return serviceTotal + productTotal;
  };

  const loadReferenceData = async () => {
    if (!supabase) {
      return;
    }

    const [
      { data: clientsData, error: clientsError },
      { data: taskClientData, error: taskClientError },
      { data: catalogData, error: catalogLoadError },
      contactsLoad,
    ] = await Promise.all([
      supabase
        .from("clients")
        .select(
          "id, company_name, street, zip_code, city, country, address_supplement, billing_street, billing_city, billing_postal_code, billing_country, email, phone, lexoffice_contact_id, lexoffice_id, contact_persons"
        )
        .order("company_name", { ascending: true }),
      supabase
        .from("tasks")
        .select("company_name, email, phone, street, zip_code, city, country, lexoffice_contact_id")
        .not("company_name", "is", null)
        .neq("company_name", ""),
      supabase
        .from("catalog")
        .select("id, item_type, name, default_price, lexoffice_id")
        .order("name", { ascending: true }),
      fetch("/api/crm/contacts", { credentials: "include" })
        .then(async (response) => {
          const json = (await response.json().catch(() => null)) as {
            ok?: boolean;
            contacts?: CrmContactDirectoryEntry[];
            error?: string;
          } | null;
          if (!response.ok) {
            console.warn("[booking] /api/crm/contacts failed:", response.status, json?.error);
            return {
              error: json?.error ?? `HTTP ${response.status}`,
              contacts: [] as CrmContactDirectoryEntry[],
            };
          }
          return { error: null as string | null, contacts: json?.contacts ?? [] };
        })
        .catch((err) => ({
          error: err instanceof Error ? err.message : "Failed to load contacts.",
          contacts: [] as CrmContactDirectoryEntry[],
        })),
    ]);

    const clientsTableMissing = clientsError?.code === "42P01";
    if (clientsError && !clientsTableMissing) {
      setFormError(`Failed to load clients: ${clientsError.message}`);
    }
    if (taskClientError) {
      setFormError(`Failed to load client suggestions: ${taskClientError.message}`);
    }

    let nextContacts = contactsLoad.contacts;
    if (contactsLoad.error || nextContacts.length === 0) {
      // Fallback 1: direct browser Supabase read (authenticated RLS) when the API
      // fails or returns empty under a misconfigured service-role key.
      const { data: directContacts, error: directError } = await supabase
        .from("contacts")
        .select(
          `
          id,
          first_name,
          last_name,
          phone,
          company_id,
          clients!contacts_company_id_fkey (
            id,
            company_name,
            street,
            city,
            zip_code,
            country,
            billing_street,
            billing_city,
            billing_postal_code,
            billing_country,
            lexoffice_contact_id,
            lexoffice_id
          ),
          contact_emails ( email, is_cc, is_primary )
        `
        )
        .order("last_name", { ascending: true })
        .order("first_name", { ascending: true });

      if (!directError && Array.isArray(directContacts) && directContacts.length > 0) {
        nextContacts = directContacts.map((row) => {
          const companyRaw = Array.isArray(row.clients) ? row.clients[0] : row.clients;
          const company = (companyRaw ?? {}) as {
            id?: string;
            company_name?: string | null;
            street?: string | null;
            city?: string | null;
            zip_code?: string | null;
            country?: string | null;
            billing_street?: string | null;
            billing_city?: string | null;
            billing_postal_code?: string | null;
            billing_country?: string | null;
            lexoffice_contact_id?: string | null;
            lexoffice_id?: string | null;
          };
          const emails = Array.isArray(row.contact_emails) ? row.contact_emails : [];
          const primary =
            emails.find((e) => e.is_primary && !e.is_cc)?.email ||
            emails.find((e) => !e.is_cc)?.email ||
            emails[0]?.email ||
            "";
          const firstName = typeof row.first_name === "string" ? row.first_name.trim() : "";
          const lastName = typeof row.last_name === "string" ? row.last_name.trim() : "";
          const fullName = [firstName, lastName].filter(Boolean).join(" ").trim() || "Contact";
          return {
            id: String(row.id),
            firstName,
            lastName,
            fullName,
            phone: typeof row.phone === "string" ? row.phone.trim() : "",
            companyId: typeof company.id === "string" ? company.id : String(row.company_id ?? ""),
            companyName: typeof company.company_name === "string" ? company.company_name.trim() : "",
            lexofficeContactId:
              (typeof company.lexoffice_contact_id === "string" &&
                company.lexoffice_contact_id.trim()) ||
              (typeof company.lexoffice_id === "string" && company.lexoffice_id.trim()) ||
              "",
            billingStreet: (company.billing_street || company.street || "").trim(),
            billingCity: (company.billing_city || company.city || "").trim(),
            billingPostalCode: (company.billing_postal_code || company.zip_code || "").trim(),
            billingCountry: (company.billing_country || company.country || "").trim(),
            primaryEmail: typeof primary === "string" ? primary.trim() : "",
            ccEmails: emails
              .filter((e) => e.is_cc && typeof e.email === "string")
              .map((e) => String(e.email).trim())
              .filter(Boolean),
          } satisfies CrmContactDirectoryEntry;
        });
        console.info(`[booking] loaded ${nextContacts.length} contacts via browser Supabase fallback`);
      } else if (directError) {
        console.warn("[booking] contacts browser fallback failed:", directError.message);
      }
    }

    // Fallback 2: synthesize options from clients.contact_persons (Lexoffice sync JSON).
    if (nextContacts.length === 0 && Array.isArray(clientsData)) {
      const synthesized: CrmContactDirectoryEntry[] = [];
      for (const client of clientsData) {
        const persons = Array.isArray((client as { contact_persons?: unknown }).contact_persons)
          ? ((client as { contact_persons: Array<Record<string, unknown>> }).contact_persons)
          : [];
        const companyId = typeof client.id === "string" ? client.id : "";
        const companyName =
          typeof client.company_name === "string" ? client.company_name.trim() : "";
        const lexofficeContactId =
          (typeof client.lexoffice_contact_id === "string" && client.lexoffice_contact_id.trim()) ||
          (typeof (client as { lexoffice_id?: string }).lexoffice_id === "string" &&
            String((client as { lexoffice_id?: string }).lexoffice_id).trim()) ||
          "";
        for (const person of persons) {
          const name = typeof person.name === "string" ? person.name.trim() : "";
          if (!name) continue;
          const parts = name.split(/\s+/);
          const firstName = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] ?? "";
          const lastName = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
          synthesized.push({
            id: `lex-${companyId}-${typeof person.id === "string" ? person.id : synthesized.length}`,
            firstName,
            lastName,
            fullName: name,
            phone: typeof person.phone === "string" ? person.phone.trim() : "",
            companyId,
            companyName,
            lexofficeContactId,
            billingStreet: (client.billing_street || client.street || "").trim(),
            billingCity: (client.billing_city || client.city || "").trim(),
            billingPostalCode: (client.billing_postal_code || client.zip_code || "").trim(),
            billingCountry: (client.billing_country || client.country || "").trim(),
            primaryEmail: typeof person.email === "string" ? person.email.trim() : "",
            ccEmails: [],
          });
        }
      }
      if (synthesized.length > 0) {
        nextContacts = synthesized;
        console.info(
          `[booking] synthesized ${synthesized.length} contacts from clients.contact_persons`
        );
      }
    }

    if (contactsLoad.error && nextContacts.length === 0) {
      setFormError(`Failed to load contacts: ${contactsLoad.error}`);
      console.warn("[booking] contacts load:", contactsLoad.error);
    }
    setCrmContacts(nextContacts);

    const mergedClients = new Map<string, ClientDirectoryEntry>();
    const applyClientRecord = (record: {
      id?: string | null;
      company_name?: string | null;
      street?: string | null;
      zip_code?: string | null;
      city?: string | null;
      country?: string | null;
      address_supplement?: string | null;
      billing_street?: string | null;
      billing_city?: string | null;
      billing_postal_code?: string | null;
      billing_country?: string | null;
      email?: string | null;
      phone?: string | null;
      lexoffice_contact_id?: string | null;
    }) => {
      const companyNameValue = (record.company_name ?? "").trim();
      if (!companyNameValue) {
        return;
      }
      const key = normalizeClientName(companyNameValue);
      const existing = mergedClients.get(key);

      const nextEntry: ClientDirectoryEntry = {
        id: existing?.id ?? record.id ?? null,
        company_name: existing?.company_name ?? companyNameValue,
        street: existing?.street || record.billing_street || record.street || "",
        zip_code: existing?.zip_code || record.billing_postal_code || record.zip_code || "",
        city: existing?.city || record.billing_city || record.city || "",
        country: existing?.country || record.billing_country || record.country || "",
        address_supplement: existing?.address_supplement || record.address_supplement || "",
        email: existing?.email || record.email || "",
        phone: existing?.phone || record.phone || "",
        lexoffice_contact_id: existing?.lexoffice_contact_id || record.lexoffice_contact_id || "",
      };
      mergedClients.set(key, nextEntry);
    };

    if (!clientsError || clientsTableMissing) {
      ((clientsData ?? []) as Client[]).forEach((record) => applyClientRecord(record));
    }
    ((taskClientData ?? []) as Client[]).forEach((record) => applyClientRecord(record));
    setClientDirectory(
      Array.from(mergedClients.values()).sort((a, b) => a.company_name.localeCompare(b.company_name, "en"))
    );

    if (catalogLoadError) {
      setFormError(`Failed to load catalog: ${catalogLoadError.message}`);
    } else {
      const rawCatalog = ((catalogData ?? []) as Array<{
        id: string | number;
        item_type: string | null;
        name: string | null;
        default_price: number | null;
        lexoffice_id: string | null;
      }>).filter((item) => item.name);

      const normalizedServices: CatalogItem[] = rawCatalog
        .filter((item) => (item.item_type ?? "").toLowerCase().trim() === "service")
        .map((item) => ({
          id: String(item.id),
          item_type: "service",
          name: item.name as string,
          default_price: Number(item.default_price ?? 0),
          lexoffice_id: item.lexoffice_id ?? null,
        }));

      const normalizedProducts: CatalogItem[] = rawCatalog
        .filter((item) => (item.item_type ?? "").toLowerCase().trim() === "product")
        .map((item) => ({
          id: String(item.id),
          item_type: "product",
          name: item.name as string,
          default_price: Number(item.default_price ?? 0),
          lexoffice_id: item.lexoffice_id ?? null,
        }));

      console.log("Fetched catalog:", rawCatalog);
      console.log("Fetched services:", normalizedServices);
      console.log("Fetched products:", normalizedProducts);

      setServiceCatalog(normalizedServices);
      setProductCatalog(normalizedProducts);
    }
  };

  useEffect(() => {
    setShowArchiveView(searchParams.get("archive") === "1");
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get(PERMISSION_DENIED_QUERY) !== "1") {
      return;
    }
    setAccessNotice("Permission denied. Admin access required.");
    const next = new URLSearchParams(searchParams.toString());
    next.delete(PERMISSION_DENIED_QUERY);
    const qs = next.toString();
    router.replace(qs ? `/kanban?${qs}` : "/kanban", { scroll: false });
  }, [searchParams, router]);

  useEffect(() => {
    if (searchParams.get("booking") !== "1") {
      return;
    }
    if (authRoleLoading) {
      return;
    }
    if (!isAdmin) {
      router.replace("/", { scroll: false });
      return;
    }
    setShowBookingModal(true);
    setFormError(null);
    setFormSuccess(null);
    void loadReferenceData();
    router.replace("/", { scroll: false });
  }, [searchParams, authRoleLoading, isAdmin, router]);

  const resetForm = () => {
    setSaveAsNewClient(false);
    setSaveToClientAddressBook(false);
    setCompanyName("");
    setSelectedClientId(null);
    setContactPerson("");
    setSelectedContactId(null);
    setStreet("");
    setZipCode("");
    setCity("");
    setAddressSupplement("");
    setLexofficeContactId("");
    setCountry("");
    setEmail("");
    setEmailCc("");
    setGalleryLink("");
    setHasSeparateInvoiceEmail(false);
    setInvoiceEmailAddress("");
    setPhone("");
    setServices([{ name: "", quantity: 1, price: 0, lexoffice_id: null }]);
    setProducts([{ name: "", quantity: 1, price: 0, lexoffice_id: null }]);
    setTaxPercentage(19);
    setAmountType("Net");
    setPhotoshootType("Immobilien");
    setGenerateGallery(true);
    setShootLocation("");
    setPhotoshootDate("");
    setPreviewPreference("first");
    setDueDate("");
    setDiscount(0);
    setSkipInvoice(false);
    setIsCreditNote(false);
    setExpectedRevenue(0);
    setIsPaid(false);
    setCurrentTaskStatus("booking");
    setLocalFolderNameDisplay("");
    setPreservedTaskTitle("");
    setFormError(null);
    setLinkedItemId(null);
    setLocalOpenPath("");
    setSoftwareToast(null);
  };

  const closeModal = () => {
    setShowBookingModal(false);
    setEditingTaskId(null);
    setIsDeleting(false);
    setOpenSections({ client: true, invoice: false, info: false });
    resetForm();
  };

  const closeUploadModal = (opts?: { cancelled?: boolean }) => {
    setShowUploadModal(false);
    setUploadTask(null);
    if (opts?.cancelled) {
      // Revert optimistic Edited placement by reloading board state.
      setRefreshSignal((prev) => prev + 1);
    }
  };

  const handleEditedIntercept = (task: BoardTask, _from: string) => {
    setUploadTask({
      ...task,
      services: Array.isArray(task.services) ? task.services : [],
      products: Array.isArray(task.products) ? task.products : [],
    });
    setShowUploadModal(true);
  };

  const handleTaskMoved = (task: BoardTask, _from: string, to: string) => {
    // Edited drops are handled by onEditedIntercept (modal gate).
    if (to === "edited") {
      return;
    }
    void task;
  };

  const openEditModal = (task: BoardTask) => {
    setEditingTaskId(task.id);
    setOpenSections({ client: true, invoice: false, info: false });
    setShowBookingModal(true);
    setFormError(null);
    setSaveAsNewClient(false);
    setCompanyName(task.companyName);
    const matchedClient = clientDirectory.find(
      (client) =>
        normalizeClientName(client.company_name) === normalizeClientName(task.companyName)
    );
    setSelectedClientId(matchedClient?.id ?? null);
    setContactPerson(
      [task.contactFirstName, task.contactLastName].filter(Boolean).join(" ").trim()
    );
    setSelectedContactId(task.contactId ?? null);
    setStreet(task.street);
    setZipCode(task.zipCode);
    setCity(task.city);
    setAddressSupplement(task.addressSupplement ?? "");
    setLexofficeContactId(task.lexofficeContactId ?? "");
    setCountry(task.country);
    setEmail(task.email);
    setEmailCc(task.emailCc ?? "");
    setGalleryLink(task.galleryLink ?? "");
    setHasSeparateInvoiceEmail(task.hasSeparateInvoiceEmail ?? false);
    setInvoiceEmailAddress(task.invoiceEmailAddress ?? "");
    setPhone(task.phone);
    setServices(
      task.services.length > 0
        ? ensureSingleTrailingEmptyRow(task.services)
        : [{ name: "", quantity: 1, price: 0, lexoffice_id: null }]
    );
    setProducts(
      task.products.length > 0
        ? ensureSingleTrailingEmptyRow(task.products)
        : [{ name: "", quantity: 1, price: 0, lexoffice_id: null }]
    );
    setTaxPercentage(task.taxPercentage);
    setAmountType(task.amountType);
    setPhotoshootType(task.photoshootType);
    setGenerateGallery(task.generateGallery ?? true);
    setShootLocation(task.shootLocation);
    setPhotoshootDate(task.photoshootDate);
    setPreviewPreference(task.previewPreference ?? "first");
    setDueDate(task.dueDate);
    setDiscount(task.discount);
    setSkipInvoice(task.skipInvoice ?? false);
    setIsCreditNote(task.isCreditNote ?? false);
    setExpectedRevenue(task.expectedRevenue ?? 0);
    setIsPaid(task.isPaid ?? false);
    setCreditNotePaid(task.creditNotePaid ?? false);
    setCreditNoteFileUrl(task.creditNoteFileUrl ?? "");
    setIsCreditNoteUploadOpen(false);
    setCurrentTaskStatus(task.status);
    setLocalFolderNameDisplay(task.localFolderName ?? "");
    setPreservedTaskTitle(task.taskTitle?.trim() ?? "");
    setLinkedItemId(task.linkedItemId ?? null);
    setLocalOpenPath(task.localOpenPath ?? "");
    void loadReferenceData();
  };

  const setSectionOpen = (section: "client" | "invoice" | "info") => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const SOFTWARE_LABELS: Record<string, string> = {
    photoshop: "Photoshop",
    lightroom: "Lightroom Classic",
    captureone: "Capture One",
  };

  const handleOpenInSoftware = async (software: string) => {
    const path = localOpenPath.trim();
    if (!path) {
      setSoftwareToast({ message: "Enter a path first.", isError: true });
      return;
    }
    setSoftwareToast({ message: `Opening in ${SOFTWARE_LABELS[software] ?? software}…`, isError: false });
    try {
      const response = await fetch("/api/local/open-software", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPath: path, software }),
      });
      const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok) {
        setSoftwareToast({ message: json?.error ?? `Failed to open (HTTP ${response.status}).`, isError: true });
      } else {
        setSoftwareToast({ message: `Opened in ${SOFTWARE_LABELS[software] ?? software}.`, isError: false });
        window.setTimeout(() => setSoftwareToast(null), 4000);
      }
    } catch (err) {
      setSoftwareToast({ message: err instanceof Error ? err.message : "Request failed.", isError: true });
    }
  };

  const handleClientNameChange = (
    option: SingleValue<ClientNameOption>,
    actionMeta: ActionMeta<ClientNameOption>
  ) => {
    if (!option) {
      setCompanyName("");
      setSelectedClientId(null);
      return;
    }

    setCompanyName(option.label);

    if (option.client) {
      const nextClientId = option.client.id;
      setSelectedClientId(nextClientId);

      // Autofill invoice/address fields from the saved business record.
      setStreet(option.client.street ?? "");
      setAddressSupplement(option.client.address_supplement ?? "");
      setZipCode(option.client.zip_code ?? "");
      setCity(option.client.city ?? "");
      setCountry(option.client.country ?? "");
      setLexofficeContactId(option.client.lexoffice_contact_id ?? "");

      // Clear a contact that belongs to a different business so the filtered
      // Contact Person list stays coherent with this company.
      if (
        selectedContactId &&
        crmContacts.some(
          (contact) =>
            contact.id === selectedContactId &&
            nextClientId &&
            contact.companyId &&
            contact.companyId !== nextClientId
        )
      ) {
        setSelectedContactId(null);
        setContactPerson("");
        setEmail("");
        setEmailCc("");
        setPhone(option.client.phone ?? "");
      } else if (!email.trim() && option.client.email) {
        setEmail(option.client.email);
      }

      if (!phone.trim() && option.client.phone) {
        setPhone(option.client.phone);
      }
      return;
    }

    // Typed / newly created business name — no CRM id yet.
    setSelectedClientId(null);

    if (actionMeta.action === "create-option") {
      // Keep email/phone/contact the user already typed; clear stale address only.
      setStreet("");
      setAddressSupplement("");
      setZipCode("");
      setCity("");
      setCountry("");
      setLexofficeContactId("");
    }
  };

  const handleContactPersonChange = (option: SingleValue<ContactPersonOption>) => {
    if (!option) {
      setSelectedContactId(null);
      setContactPerson("");
      return;
    }

    if (!option.contact) {
      // Free-text / create path — keep typed name only; link to selected business on save.
      setSelectedContactId(null);
      setContactPerson(option.label);
      return;
    }

    const contact = option.contact;
    // Synthesized Lexoffice JSON rows use `lex-…` ids and are not real contacts FK rows.
    const isPersistedContact =
      Boolean(contact.id) &&
      !contact.id.startsWith("lex-") &&
      /^[0-9a-f-]{36}$/i.test(contact.id);
    setSelectedContactId(isPersistedContact ? contact.id : null);
    setContactPerson(contact.fullName);
    setCompanyName(contact.companyName);
    setSelectedClientId(contact.companyId || null);
    setEmail(contact.primaryEmail);
    setEmailCc(contact.ccEmails.join(", "));
    setPhone(contact.phone);
    setStreet(contact.billingStreet);
    setZipCode(contact.billingPostalCode);
    setCity(contact.billingCity);
    setCountry(contact.billingCountry);
    setLexofficeContactId(contact.lexofficeContactId);

    const matchedClient = clientDirectory.find(
      (client) =>
        (contact.companyId && client.id === contact.companyId) ||
        normalizeClientName(client.company_name) === normalizeClientName(contact.companyName)
    );
    if (matchedClient) {
      setAddressSupplement(matchedClient.address_supplement ?? "");
      if (!contact.billingStreet && matchedClient.street) {
        setStreet(matchedClient.street);
      }
      if (!contact.billingPostalCode && matchedClient.zip_code) {
        setZipCode(matchedClient.zip_code);
      }
      if (!contact.billingCity && matchedClient.city) {
        setCity(matchedClient.city);
      }
      if (!contact.billingCountry && matchedClient.country) {
        setCountry(matchedClient.country);
      }
    }
  };

  const openCatalogModal = (type: ItemType) => {
    setNewCatalogType(type);
    setNewCatalogName("");
    setNewCatalogPrice(0);
    setCatalogError(null);
    setShowCatalogModal(true);
  };

  const handleCreateCatalogItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCatalogError(null);

    if (!supabase) {
      setCatalogError(
        "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
      );
      return;
    }

    if (!newCatalogName.trim()) {
      setCatalogError("Item name is required.");
      return;
    }

    const itemTypeValue = newCatalogType.toLowerCase();
    const { data, error } = await supabase
      .from("catalog")
      .insert({
        item_type: itemTypeValue,
        name: newCatalogName.trim(),
        default_price: Number(newCatalogPrice) || 0,
      })
      .select("id, item_type, name, default_price, lexoffice_id")
      .single();

    if (error) {
      setCatalogError(error.message);
      return;
    }

    if (data) {
      const newItem: CatalogItem = {
        id: String(data.id),
        item_type: String(data.item_type ?? "").toLowerCase(),
        name: data.name,
        default_price: Number(data.default_price ?? 0),
        lexoffice_id: data.lexoffice_id ?? null,
      };
      if (newItem.item_type === "service") {
        setServiceCatalog((prev) => [...prev, newItem]);
      } else if (newItem.item_type === "product") {
        setProductCatalog((prev) => [...prev, newItem]);
      } else {
        await loadReferenceData();
      }
    } else {
      await loadReferenceData();
    }

    setShowCatalogModal(false);
  };

  const handleDelete = async () => {
    if (!editingTaskId || isDeleting || isSubmitting) {
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to permanently delete this booking? This cannot be undone."
    );
    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    setFormError(null);

    try {
      const response = await fetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ taskId: editingTaskId }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? `Failed to delete booking (HTTP ${response.status}).`);
      }

      closeModal();
      setRefreshSignal((prev) => prev + 1);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to delete booking.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (authRoleLoading) {
      return;
    }

    if (!supabase) {
      setFormError(
        "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
      );
      return;
    }

    if (!authRoleLoading && !isAdmin && !editingTaskId) {
      setFormError("Only administrators can create new bookings.");
      return;
    }

    if (!shootLocation.trim() || !photoshootDate) {
      setFormError("Photoshoot Location and Photoshoot Date are required.");
      return;
    }

    if (isAdmin && !companyName.trim()) {
      setFormError("Invoice Name / Billing Entity is required.");
      return;
    }

    if (hasSeparateInvoiceEmail && !invoiceEmailAddress.trim()) {
      setFormError("Invoice Email Address is required when Separate Invoice Email is checked.");
      return;
    }

    const { firstName: contactFirstName, lastName: contactLastName } = splitContactPerson(contactPerson);

    setIsSubmitting(true);

    if (editingTaskId && !isAdmin) {
      const editorPayload = {
        photoshoot_type: photoshootType,
        shoot_location: shootLocation,
        photoshoot_date: photoshootDate,
        preview_preference: previewPreference,
        due_date: dueDate || null,
        title:
          preservedTaskTitle.trim() ||
          `${photoshootType} - ${companyName.trim() || contactPerson.trim() || "Client"} - ${shootLocation}`,
        status: {
          "awaiting-folders": "awaiting_folder_creation",
          booking: "Booking",
          "preview-sent": "Preview Sent",
          "selection-available": "Selection Available",
          editing: "Editing",
          "ready-for-review": "Ready for Review",
          edited: "Edited",
          "send-email": "Send Email",
          completed: "Completed",
        }[currentTaskStatus],
        skip_invoice: skipInvoice,
      };
      const { error } = await supabase.from("tasks").update(editorPayload).eq("id", editingTaskId);
      setIsSubmitting(false);
      if (error) {
        setFormError(error.message);
        return;
      }
      closeModal();
      setRefreshSignal((prev) => prev + 1);
      await loadReferenceData();
      return;
    }

    const selectedServices = services
      .filter((service) => service.name.trim() !== "")
      .map((service) => ({
        name: service.name,
        quantity: Number(service.quantity) || 1,
        price: Number(service.price) || 0,
        lexoffice_id:
          service.lexoffice_id ??
          serviceCatalog.find((catalogItem) => catalogItem.name === service.name)?.lexoffice_id ??
          null,
      }));
    const selectedProducts = products
      .filter((product) => product.name.trim() !== "")
      .map((product) => ({
        name: product.name,
        quantity: Number(product.quantity) || 1,
        price: Number(product.price) || 0,
        lexoffice_id:
          product.lexoffice_id ??
          productCatalog.find((catalogItem) => catalogItem.name === product.name)?.lexoffice_id ??
          null,
      }));
    const servicesLexofficeIds = selectedServices.map((service) => service.lexoffice_id ?? "");
    const productsLexofficeIds = selectedProducts.map((product) => product.lexoffice_id ?? "");
    const displayClientLabel = companyName.trim() || contactPerson.trim() || "Client";
    const generatedTitle = `${photoshootType} - ${displayClientLabel} - ${shootLocation}`;

    const payload: TaskSupabasePayload = {
      company_name: companyName.trim(),
      contact_first_name: contactFirstName.trim(),
      contact_last_name: contactLastName.trim(),
      contact_id: selectedContactId,
      street,
      zip_code: zipCode,
      city,
      lexoffice_contact_id: lexofficeContactId || null,
      country,
      address_supplement: addressSupplement,
      email: email.trim(),
      email_cc: emailCc.trim() || null,
      gallery_link: galleryLink.trim() || null,
      has_separate_invoice_email: hasSeparateInvoiceEmail,
      invoice_email_address:
        hasSeparateInvoiceEmail && invoiceEmailAddress.trim()
          ? invoiceEmailAddress.trim()
          : null,
      phone,
      services: selectedServices,
      products: selectedProducts,
      services_lexoffice_id: servicesLexofficeIds,
      products_lexoffice_id: productsLexofficeIds,
      tax_percentage: taxPercentage,
      amount_type: amountType,
      discount,
      photoshoot_type: photoshootType,
      generate_gallery: generateGallery,
      shoot_location: shootLocation,
      photoshoot_date: photoshootDate,
      preview_preference: previewPreference,
      due_date: dueDate || null,
      status: editingTaskId
        ? {
            "awaiting-folders": "awaiting_folder_creation",
            booking: "Booking",
            "preview-sent": "Preview Sent",
            "selection-available": "Selection Available",
            editing: "Editing",
            "ready-for-review": "Ready for Review",
            edited: "Edited",
            "send-email": "Send Email",
            completed: "Completed",
          }[currentTaskStatus]
        : "awaiting_folder_creation",
      title: generatedTitle,
      client: displayClientLabel,
      skip_invoice: skipInvoice,
      is_credit_note: isCreditNote,
      expected_revenue: isCreditNote ? Number(expectedRevenue) || 0 : 0,
      // Credit notes can only become paid via upload modal (sets credit_note_paid + is_paid).
      is_paid: isCreditNote ? creditNotePaid : isPaid,
      credit_note_paid: isCreditNote ? creditNotePaid : false,
      credit_note_file_url: isCreditNote ? creditNoteFileUrl || null : null,
      linked_item_id: linkedItemId ?? null,
      local_open_path: localOpenPath.trim() || null,
    };

    if (editingTaskId) {
      const updateResponse = await fetch("/api/tasks/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: editingTaskId, ...payload }),
      });
      setIsSubmitting(false);

      const updateBody = (await updateResponse.json().catch(() => null)) as { error?: string } | null;
      if (!updateResponse.ok) {
        setFormError(updateBody?.error ?? `Could not update booking (HTTP ${updateResponse.status}).`);
        return;
      }
    } else {
      const createResponse = await fetch("/api/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...payload, bracket_size: 3 }),
      });
      setIsSubmitting(false);

      const createBody = (await createResponse.json().catch(() => null)) as { error?: string; id?: string } | null;
      if (!createResponse.ok) {
        setFormError(createBody?.error ?? `Could not create booking (HTTP ${createResponse.status}).`);
        return;
      }
    }

    if (!editingTaskId) {
      setFormSuccess("Booking Created Successfully");
    }

    closeModal();
    setRefreshSignal((prev) => prev + 1);
    await loadReferenceData();
  };

  useEffect(() => {
    if (initialClientsLoad.current === null) {
      initialClientsLoad.current = loadReferenceData();
    }
  }, []);

  const runDriveUploadAndFinalize = async (files: File[]) => {
    if (!uploadTask) {
      throw new Error("Missing upload task.");
    }
    if (files.length === 0) {
      throw new Error("Please select at least one file.");
    }
    if (!uploadTask.email.trim()) {
      throw new Error("Cannot finalize: client email is missing on this task.");
    }
    if (!uploadTask.localFolderName.trim()) {
      throw new Error(
        "Cannot finalize: no local folder is set for this task. Ensure the PC worker has created shoot folders."
      );
    }

    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }

    const uploadPayload = {
      id: uploadTask.id,
      title: getTaskTitle(uploadTask),
      email: uploadTask.email,
      photoshoot_type: uploadTask.photoshootType,
      company_name: uploadTask.companyName,
      contact_first_name: uploadTask.contactFirstName,
      contact_last_name: uploadTask.contactLastName,
      shoot_location: uploadTask.shootLocation,
      photoshoot_date: uploadTask.photoshootDate,
      due_date: uploadTask.dueDate,
      price: calculateTaskPrice(uploadTask),
      services: Array.isArray(uploadTask.services) ? uploadTask.services : [],
      products: Array.isArray(uploadTask.products) ? uploadTask.products : [],
      services_lexoffice_id: (Array.isArray(uploadTask.services) ? uploadTask.services : []).map(
        (s) => s.lexoffice_id ?? ""
      ),
      products_lexoffice_id: (Array.isArray(uploadTask.products) ? uploadTask.products : []).map(
        (p) => p.lexoffice_id ?? ""
      ),
      skip_invoice: uploadTask.skipInvoice ?? false,
    };

    formData.append("taskData", JSON.stringify(uploadPayload));

    const uploadResponse = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    }).catch((err: unknown) => {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Drive upload request failed (${detail}). Immobilien batches with many large JPEGs often exceed the server body limit — try fewer files or upload in smaller batches.`
      );
    });

    if (!uploadResponse.ok) {
      let message = "Upload failed.";
      try {
        const errorPayload = (await uploadResponse.json()) as { error?: string };
        if (errorPayload.error) message = errorPayload.error;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }

    // Existing Google Drive + email finalize path (unchanged).
    const finalizePayload = buildFinalizeShootPayload(uploadTask);
    const finalizeResponse = await fetch("/api/workflows/finalize-shoot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalizePayload),
    });

    const finalizeJson = (await finalizeResponse.json().catch(() => null)) as {
      success?: boolean;
      error?: unknown;
      step?: string;
      skippedInvoice?: boolean;
      status?: string;
    } | null;

    if (!finalizeResponse.ok || !finalizeJson?.success) {
      const detail =
        finalizeJson?.error instanceof Error
          ? finalizeJson.error.message
          : typeof finalizeJson?.error === "string"
            ? finalizeJson.error
            : `Finalize shoot failed (${finalizeResponse.status}).`;
      const step = typeof finalizeJson?.step === "string" ? finalizeJson.step : "";
      // Still mark status so the card progresses even if an optional step failed.
      void updateTaskStatus(uploadTask.id, "Send Email");
      throw new Error(step ? `${detail} (step: ${step})` : detail);
    }

    // Ensure Kanban reflects Edited staging completed into the finalize workflow status.
    const workflowStatus =
      typeof finalizeJson.status === "string" && finalizeJson.status.trim()
        ? finalizeJson.status.trim()
        : finalizeJson.skippedInvoice
          ? "Send Email"
          : "Invoice Sent";
    void workflowStatus;
  };

  const runSocialGridSchedule = async (socialFiles: File[]) => {
    if (!uploadTask) {
      throw new Error("Missing upload task.");
    }
    if (socialFiles.length === 0) {
      return;
    }

    const fileUrls = await uploadSocialDeliverableFiles(socialFiles, uploadTask.id);

    const response = await fetch("/api/social/queue-from-deliverables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        taskId: uploadTask.id,
        photoshootType: uploadTask.photoshootType,
        clientName:
          uploadTask.companyName.trim() ||
          [uploadTask.contactFirstName, uploadTask.contactLastName].filter(Boolean).join(" ").trim(),
        shootLocation: uploadTask.shootLocation,
        fileUrls,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      success?: boolean;
      error?: string;
      message?: string;
    } | null;

    if (!response.ok || payload?.success === false) {
      throw new Error(payload?.error ?? `Social scheduling failed (${response.status}).`);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-8 font-sans dark:bg-black sm:px-6 lg:px-8">
      <main className="mx-auto w-full min-w-0 max-w-[1800px]">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Image
              src="/logo.webp"
              alt="Workflow"
              width={480}
              height={132}
              className="mt-0.5 h-[132px] w-auto max-w-[min(600px,90vw)] shrink-0 object-contain"
              priority
            />
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-3xl">
                Workflow
              </h1>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Drag and drop tasks between stages to track each shoot from booking to delivery.
              </p>
            </div>
          </div>
          {!authRoleLoading && authenticated ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:max-w-[780px] sm:justify-end">
              <Suspense fallback={null}>
                <GlobalNavButtons
                  className="flex flex-wrap items-center justify-end gap-2"
                  secondaryMiddle={<JibbleClockToggle />}
                >
                  <GlobalLogoutControl />
                </GlobalNavButtons>
              </Suspense>
            </div>
          ) : null}
        </div>

        {accessNotice ? (
          <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            {accessNotice}
          </p>
        ) : null}

        {formSuccess ? (
          <p className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            {formSuccess}
          </p>
        ) : null}

        {!authRoleLoading && isAdmin ? (
          <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,10fr)_minmax(120px,0.4fr)]">
            <div className="min-w-0 overflow-x-auto">
              <KanbanBoard
                refreshSignal={refreshSignal}
                onTaskClick={openEditModal}
                onTaskMoved={handleTaskMoved}
                onEditedIntercept={handleEditedIntercept}
                showArchived={showArchiveView}
                onBoardChange={setAllBoardTasks}
              />
            </div>
            <div className="min-w-0">
              <StatsSidebar refreshSignal={refreshSignal} />
            </div>
          </div>
        ) : (
          <div className="min-w-0 overflow-x-auto">
            <KanbanBoard
              refreshSignal={refreshSignal}
              onTaskClick={openEditModal}
              onTaskMoved={handleTaskMoved}
              onEditedIntercept={handleEditedIntercept}
              showArchived={showArchiveView}
              onBoardChange={setAllBoardTasks}
            />
          </div>
        )}
      </main>

      {showBookingModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900 sm:p-8">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                  {editingTaskId ? "Edit Task" : "New Booking"}
                </h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {editingTaskId
                    ? "Update task details and save changes to Supabase."
                    : "Fill in the booking details and create a new task in Supabase."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md px-2 py-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                X
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {isAdmin ? (
              <section className="overflow-hidden rounded-xl border border-zinc-200 dark:border-amber-900/70">
                <button
                  type="button"
                  onClick={() => setSectionOpen("client")}
                  className="flex w-full items-center justify-between bg-zinc-50 px-4 py-3 text-left dark:bg-zinc-800/70"
                >
                  <span className="text-sm font-semibold text-zinc-900 dark:text-amber-200">Client</span>
                  <span className="text-xs text-zinc-600 dark:text-amber-300">{openSections.client ? "Hide" : "Show"}</span>
                </button>
                {openSections.client ? (
                  <div className="space-y-4 bg-white px-4 py-4 dark:bg-zinc-900">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="sm:col-span-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Contact Person <span className="font-normal text-zinc-500">(searchable)</span>
                        <CreatableSelect<ContactPersonOption, false>
                          isClearable
                          isSearchable
                          options={contactPersonOptions}
                          value={selectedContactOption}
                          onChange={handleContactPersonChange}
                          placeholder={
                            companyName.trim()
                              ? `Search contacts at ${companyName.trim()}…`
                              : "Search contact name or company…"
                          }
                          formatCreateLabel={(inputValue) => `Use "${inputValue}"`}
                          classNames={
                            clientNameSelectClassNames as unknown as ClassNamesConfig<ContactPersonOption, false>
                          }
                          filterOption={(option, rawInput) => {
                            const q = rawInput.trim().toLowerCase();
                            if (!q) return true;
                            const contact = option.data.contact;
                            const haystack = [
                              option.label,
                              contact?.fullName,
                              contact?.companyName,
                              contact?.primaryEmail,
                              ...(contact?.ccEmails ?? []),
                            ]
                              .filter(Boolean)
                              .join(" ")
                              .toLowerCase();
                            return haystack.includes(q);
                          }}
                        />
                      </label>
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Email Address
                        <input
                          type="email"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Phone Number
                        <input
                          value={phone}
                          onChange={(event) => setPhone(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>
                      <label className="sm:col-span-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        CC Emails <span className="font-normal text-zinc-500">(comma-separated)</span>
                        <input
                          type="text"
                          value={emailCc}
                          onChange={(event) => setEmailCc(event.target.value)}
                          placeholder="cc1@example.com, cc2@example.com"
                          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>
                      <label className="sm:col-span-2 inline-flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          checked={hasSeparateInvoiceEmail}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setHasSeparateInvoiceEmail(checked);
                            if (!checked) {
                              setInvoiceEmailAddress("");
                            }
                          }}
                        />
                        Separate Invoice Email
                      </label>
                      {hasSeparateInvoiceEmail ? (
                        <label className="sm:col-span-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          Invoice Email Address{" "}
                          <span className="font-normal text-zinc-500">(comma-separated OK)</span>
                          <input
                            type="text"
                            value={invoiceEmailAddress}
                            onChange={(event) => setInvoiceEmailAddress(event.target.value)}
                            placeholder="billing@company.com, ap@company.com"
                            required
                            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                          />
                          <span className="mt-1 block text-[11px] font-normal text-zinc-500">
                            Gallery delivery stays on the contact email; the invoice draft goes here.
                          </span>
                        </label>
                      ) : null}
                    </div>
                    {!editingTaskId ? (
                      <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          checked={saveAsNewClient}
                          onChange={(event) => setSaveAsNewClient(event.target.checked)}
                        />
                        Save as New Client
                      </label>
                    ) : (
                      <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          checked={saveToClientAddressBook}
                          onChange={(event) => setSaveToClientAddressBook(event.target.checked)}
                        />
                        Save to Client Address Book
                      </label>
                    )}
                  </div>
                ) : null}
              </section>
              ) : null}

              {isAdmin ? (
              <section className="overflow-hidden rounded-xl border border-zinc-200 dark:border-amber-900/70">
                <button
                  type="button"
                  onClick={() => setSectionOpen("invoice")}
                  className="flex w-full items-center justify-between bg-zinc-50 px-4 py-3 text-left dark:bg-zinc-800/70"
                >
                  <span className="text-sm font-semibold text-zinc-900 dark:text-amber-200">Invoice</span>
                  <span className="text-xs text-zinc-600 dark:text-amber-300">{openSections.invoice ? "Hide" : "Show"}</span>
                </button>
                {openSections.invoice ? (
                  <div className="space-y-4 bg-white px-4 py-4 dark:bg-zinc-900">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="sm:col-span-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Invoice Name / Billing Entity
                        <CreatableSelect<ClientNameOption, false>
                          isClearable
                          options={clientNameOptions}
                          value={selectedClientNameOption}
                          onChange={handleClientNameChange}
                          placeholder="Who should be billed on the invoice?"
                          formatCreateLabel={(inputValue) => `Create "${inputValue}"`}
                          classNames={clientNameSelectClassNames}
                        />
                      </label>
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Street
                        <input
                          value={street}
                          onChange={(event) => setStreet(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>
                      <label className="sm:col-span-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Addresszusatz <span className="font-normal text-zinc-500">(optional)</span>
                        <input
                          value={addressSupplement}
                          onChange={(event) => setAddressSupplement(event.target.value)}
                          placeholder="z. B. Gebäude, Etage, c/o"
                          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Country <span className="font-normal text-zinc-500">(ISO e.g. DE, AT, CH)</span>
                        <input
                          value={country}
                          onChange={(event) => setCountry(event.target.value)}
                          placeholder="DE"
                          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Zip Code
                        <input
                          value={zipCode}
                          onChange={(event) => setZipCode(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        City
                        <input
                          value={city}
                          onChange={(event) => setCity(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>
                      <label className="sm:col-span-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Gallery Link{" "}
                        <span className="font-normal text-zinc-500">
                          (auto-filled from Google Drive after final upload; shown on invoice)
                        </span>
                        <input
                          type="url"
                          value={galleryLink}
                          onChange={(event) => setGalleryLink(event.target.value)}
                          placeholder="Filled automatically when Drive folder is created…"
                          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                        {galleryLink.trim() ? (
                          <a
                            href={galleryLink.trim()}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block text-xs font-medium text-amber-700 underline underline-offset-2 hover:text-amber-600 dark:text-amber-300"
                          >
                            Open gallery
                          </a>
                        ) : (
                          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                            Set automatically when finished photos are uploaded from the Edited
                            column (finalize-shoot creates the Drive folder).
                          </p>
                        )}
                      </label>
                      <label className="sm:col-span-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Lexoffice Contact ID
                        <input
                          value={lexofficeContactId}
                          onChange={(event) => setLexofficeContactId(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>
                      <label className="sm:col-span-2 inline-flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          checked={skipInvoice}
                          onChange={(event) => setSkipInvoice(event.target.checked)}
                        />
                        No Invoice (skip Lexoffice invoice workflow)
                      </label>
                      <label className="sm:col-span-2 inline-flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          checked={isCreditNote}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setIsCreditNote(checked);
                            if (!checked) {
                              setExpectedRevenue(0);
                              setCreditNotePaid(false);
                              setCreditNoteFileUrl("");
                            }
                          }}
                        />
                        Credit Note (self-billing / expected fee tracking)
                      </label>
                      {isCreditNote ? (
                        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          Expected Fee (€)
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={expectedRevenue}
                            onChange={(event) => setExpectedRevenue(Number(event.target.value) || 0)}
                            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                          />
                        </label>
                      ) : null}
                      {isCreditNote ? (
                        <div className="sm:col-span-2 space-y-1">
                          <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                            <input
                              type="checkbox"
                              checked={creditNotePaid}
                              onChange={(event) => {
                                if (event.target.checked) {
                                  // Intercept: require PDF upload before checking / saving paid.
                                  if (!editingTaskId) {
                                    setFormError(
                                      "Save the booking first, then mark the credit note as paid."
                                    );
                                    return;
                                  }
                                  setIsCreditNoteUploadOpen(true);
                                  return;
                                }
                                setCreditNotePaid(false);
                                setIsPaid(false);
                                setCreditNoteFileUrl("");
                              }}
                            />
                            Credit Note Paid
                          </label>
                          {creditNoteFileUrl ? (
                            <a
                              href={creditNoteFileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="block text-xs font-medium text-amber-700 underline underline-offset-2 hover:text-amber-600 dark:text-amber-300"
                            >
                              View uploaded credit note
                            </a>
                          ) : null}
                        </div>
                      ) : (
                        <label className="sm:col-span-2 inline-flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          <input
                            type="checkbox"
                            checked={isPaid}
                            onChange={(event) => setIsPaid(event.target.checked)}
                          />
                          Is Paid
                        </label>
                      )}
                    </div>
                    <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Services Booked</h3>
                  <button
                    type="button"
                    onClick={() => openCatalogModal("Service")}
                    className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Create New Service/Product
                  </button>
                </div>
                {services.map((item, index) => (
                  <div key={`service-${index}`} className="grid gap-2 sm:grid-cols-3">
                    <Select<CatalogOption, false>
                      isClearable
                      options={serviceOptions}
                      value={serviceOptions.find((option) => option.name === item.name) ?? null}
                      onChange={(option) => {
                        const nextName = option?.name ?? "";
                        setServices((prev) => {
                          const updated = [...prev];
                          updated[index] = {
                            ...updated[index],
                            name: nextName,
                            price: option ? option.defaultPrice : 0,
                            lexoffice_id: option?.lexoffice_id ?? null,
                          };
                          return ensureSingleTrailingEmptyRow(updated);
                        });
                      }}
                      placeholder="Select a service"
                      styles={selectStyles}
                    />
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setServices((prev) => {
                          const updated = [...prev];
                          updated[index] = { ...updated[index], quantity: Number.isFinite(value) ? value : 1 };
                          return updated;
                        });
                      }}
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="Quantity"
                    />
                    <input
                      type="number"
                      min={0}
                      value={item.price}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setServices((prev) => {
                          const updated = [...prev];
                          updated[index] = { ...updated[index], price: Number.isFinite(value) ? value : 0 };
                          return updated;
                        });
                      }}
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="Unit Price"
                    />
                  </div>
                ))}
                    </div>

                    <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Products Booked</h3>
                  <button
                    type="button"
                    onClick={() => openCatalogModal("Product")}
                    className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Create New Service/Product
                  </button>
                </div>
                {products.map((item, index) => (
                  <div key={`product-${index}`} className="grid gap-2 sm:grid-cols-3">
                    <Select<CatalogOption, false>
                      isClearable
                      options={productOptions}
                      value={productOptions.find((option) => option.name === item.name) ?? null}
                      onChange={(option) => {
                        const nextName = option?.name ?? "";
                        setProducts((prev) => {
                          const updated = [...prev];
                          updated[index] = {
                            ...updated[index],
                            name: nextName,
                            price: option ? option.defaultPrice : 0,
                            lexoffice_id: option?.lexoffice_id ?? null,
                          };
                          return ensureSingleTrailingEmptyRow(updated);
                        });
                      }}
                      placeholder="Select a product"
                      styles={selectStyles}
                    />
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setProducts((prev) => {
                          const updated = [...prev];
                          updated[index] = { ...updated[index], quantity: Number.isFinite(value) ? value : 1 };
                          return updated;
                        });
                      }}
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="Quantity"
                    />
                    <input
                      type="number"
                      min={0}
                      value={item.price}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setProducts((prev) => {
                          const updated = [...prev];
                          updated[index] = { ...updated[index], price: Number.isFinite(value) ? value : 0 };
                          return updated;
                        });
                      }}
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="Unit Price"
                    />
                  </div>
                ))}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Tax Percentage
                  <input
                    type="number"
                    value={taxPercentage}
                    onChange={(event) => setTaxPercentage(Number(event.target.value))}
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </label>
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Discount
                  <input
                    type="number"
                    value={discount}
                    onChange={(event) => setDiscount(Number(event.target.value))}
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </label>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                <fieldset className="rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
                  <legend className="px-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Amount Type</legend>
                  <div className="mt-1 flex gap-4 text-sm text-zinc-800 dark:text-zinc-200">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="amountType"
                        checked={amountType === "Net"}
                        onChange={() => setAmountType("Net")}
                      />
                      Net
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="amountType"
                        checked={amountType === "Gross"}
                        onChange={() => setAmountType("Gross")}
                      />
                      Gross
                    </label>
                  </div>
                </fieldset>
                    </div>
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/60">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">Total Net</span>
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {currencyFormatter.format(invoiceTotals.totalNet)}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">Total Tax</span>
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {currencyFormatter.format(invoiceTotals.totalTax)}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">Total Gross</span>
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {currencyFormatter.format(invoiceTotals.totalGross)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>
              ) : null}

              <section className="overflow-hidden rounded-xl border border-zinc-200 dark:border-amber-900/70">
                <button
                  type="button"
                  onClick={() => setSectionOpen("info")}
                  className="flex w-full items-center justify-between bg-zinc-50 px-4 py-3 text-left dark:bg-zinc-800/70"
                >
                  <span className="text-sm font-semibold text-zinc-900 dark:text-amber-200">Info</span>
                  <span className="text-xs text-zinc-600 dark:text-amber-300">{openSections.info ? "Hide" : "Show"}</span>
                </button>
                {openSections.info ? (
                  <div className="grid gap-4 bg-white px-4 py-4 dark:bg-zinc-900 sm:grid-cols-2">
                    <label className="sm:col-span-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Photoshoot Location
                      <input
                        required
                        value={shootLocation}
                        onChange={(event) => setShootLocation(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                    </label>
                    <label className="sm:col-span-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Type of Photoshoot
                      <select
                        value={photoshootType}
                        onChange={(event) => setPhotoshootType(event.target.value as PhotoshootType)}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      >
                        <option value="Immobilien">Immobilien</option>
                        <option value="Business Portraits">Business Portraits</option>
                        <option value="Food">Food</option>
                        <option value="Product">Product</option>
                        <option value="Portrait Pro">Portrait Pro</option>
                        <option value="Studio Portrait">Studio Portrait</option>
                        <option value="Hochzeit">Hochzeit</option>
                        <option value="Mini Session">Mini Session</option>
                        <option value="Event">Event</option>
                      </select>
                    </label>
                    <label className="sm:col-span-2 inline-flex items-start gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={generateGallery}
                        onChange={(event) => setGenerateGallery(event.target.checked)}
                        className="mt-0.5"
                      />
                      <span>
                        Generate Client Gallery
                        <span className="mt-0.5 block text-[11px] font-normal text-zinc-500">
                          When unchecked, the worker skips watermarked preview generation and storage uploads for this booking.
                        </span>
                      </span>
                    </label>
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Date
                      <input
                        type="date"
                        required
                        value={photoshootDate}
                        onChange={(event) => setPhotoshootDate(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                    </label>
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Preview Photo Selection
                      <select
                        value={previewPreference}
                        onChange={(event) => setPreviewPreference(event.target.value as PreviewPreference)}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      >
                        <option value="first">First Photo (Darkest)</option>
                        <option value="middle">Middle Photo (Balanced)</option>
                        <option value="last">Last Photo (Brightest)</option>
                      </select>
                    </label>
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Due Date
                      <input
                        type="date"
                        value={dueDate}
                        onChange={(event) => setDueDate(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                    </label>
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Task ID
                      <input
                        value={editingTaskId ?? "Will be created"}
                        readOnly
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                      />
                    </label>
                    {editingTaskId ? (
                      <label className="sm:col-span-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Local Folder Name
                        <input
                          value={localFolderNameDisplay.trim() || "— (created when task was saved)"}
                          readOnly
                          className="mt-1 w-full rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                        />
                      </label>
                    ) : null}
                    <div className="sm:col-span-2">
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Local Folder / File Path
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        Full path to open directly in Photoshop, Lightroom or Capture One.
                      </p>
                      <div className="mt-1 flex gap-2">
                        <input
                          value={localOpenPath}
                          onChange={(e) => setLocalOpenPath(e.target.value)}
                          placeholder="e.g. Z:\Shoots\Smith_Apartment or /Volumes/Shoots/Smith"
                          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                        <button
                          type="button"
                          disabled={!localOpenPath.trim()}
                          onClick={() => void handleOpenInSoftware("photoshop")}
                          title="Open in Adobe Photoshop"
                          className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-bold text-zinc-700 transition hover:border-[#31A8FF] hover:bg-[#001E36] hover:text-[#31A8FF] disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                        >
                          Ps
                        </button>
                        <button
                          type="button"
                          disabled={!localOpenPath.trim()}
                          onClick={() => void handleOpenInSoftware("lightroom")}
                          title="Open in Adobe Lightroom Classic"
                          className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-bold text-zinc-700 transition hover:border-[#4F9BFF] hover:bg-[#001326] hover:text-[#4F9BFF] disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                        >
                          Lr
                        </button>
                        <button
                          type="button"
                          disabled={!localOpenPath.trim()}
                          onClick={() => void handleOpenInSoftware("captureone")}
                          title="Open in Capture One"
                          className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-bold text-zinc-700 transition hover:border-[#FF5722] hover:bg-zinc-900 hover:text-[#FF5722] disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                        >
                          C1
                        </button>
                      </div>
                      {softwareToast ? (
                        <p
                          className={`mt-1.5 text-xs font-medium ${
                            softwareToast.isError ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {softwareToast.message}
                        </p>
                      ) : null}
                    </div>
                    <label className="sm:col-span-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Link to Shoot / Task
                      <select
                        value={linkedItemId ?? ""}
                        onChange={(event) => setLinkedItemId(event.target.value || null)}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      >
                        <option value="">— No link —</option>
                        {allBoardTasks
                          .filter((t) => t.id !== editingTaskId)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {[t.photoshootType, t.companyName, t.shootLocation].filter(Boolean).join(" · ") || t.taskTitle || t.id}
                            </option>
                          ))}
                      </select>
                      {linkedItemId ? (() => {
                        const linked = allBoardTasks.find((t) => t.id === linkedItemId);
                        return linked ? (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-md border border-violet-400/50 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:border-violet-600/40 dark:bg-violet-950/30 dark:text-violet-300">
                            🔗 Linked to: {[linked.photoshootType, linked.companyName, linked.shootLocation].filter(Boolean).join(" · ") || linked.taskTitle || linked.id}
                          </span>
                        ) : null;
                      })() : null}
                    </label>
                  </div>
                ) : null}
              </section>

              {formError ? <p className="text-sm text-red-600 dark:text-red-400">{formError}</p> : null}

              <div className="flex items-center justify-between gap-3 pt-2">
                {editingTaskId && isAdmin ? (
                  <button
                    type="button"
                    onClick={() => void handleDelete()}
                    disabled={isDeleting || isSubmitting || authRoleLoading}
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-red-300 px-4 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    {isDeleting ? "Deleting..." : "Delete Booking"}
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={isDeleting}
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || isDeleting || authRoleLoading}
                    className="inline-flex h-10 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    {isSubmitting ? "Saving..." : editingTaskId ? "Save Changes" : "Create Booking"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showCatalogModal ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Create Catalog Item</h3>
            <form onSubmit={handleCreateCatalogItem} className="mt-4 space-y-3">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Type
                <select
                  value={newCatalogType}
                  onChange={(event) => setNewCatalogType(event.target.value as ItemType)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <option value="Service">Service</option>
                  <option value="Product">Product</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Name
                <input
                  value={newCatalogName}
                  onChange={(event) => setNewCatalogName(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Default Price
                <input
                  type="number"
                  min={0}
                  value={newCatalogPrice}
                  onChange={(event) => setNewCatalogPrice(Number(event.target.value))}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>
              {catalogError ? <p className="text-sm text-red-600 dark:text-red-400">{catalogError}</p> : null}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowCatalogModal(false)}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Add Item
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <UploadDeliverablesModal
        open={showUploadModal}
        task={
          uploadTask
            ? {
                id: uploadTask.id,
                taskTitle: getTaskTitle(uploadTask),
                localFolderName: uploadTask.localFolderName,
                companyName: uploadTask.companyName,
                lexofficeContactId: uploadTask.lexofficeContactId,
                contactFirstName: uploadTask.contactFirstName,
                contactLastName: uploadTask.contactLastName,
                email: uploadTask.email,
                emailCc: uploadTask.emailCc,
                street: uploadTask.street,
                zipCode: uploadTask.zipCode,
                city: uploadTask.city,
                country: uploadTask.country,
                addressSupplement: uploadTask.addressSupplement,
                galleryLink: uploadTask.galleryLink,
                hasSeparateInvoiceEmail: uploadTask.hasSeparateInvoiceEmail,
                invoiceEmailAddress: uploadTask.invoiceEmailAddress,
                services: uploadTask.services,
                products: uploadTask.products,
                taxPercentage: uploadTask.taxPercentage,
                amountType: uploadTask.amountType,
                discount: uploadTask.discount,
                photoshootType: uploadTask.photoshootType,
                shootLocation: uploadTask.shootLocation,
                photoshootDate: uploadTask.photoshootDate,
                skipInvoice: uploadTask.skipInvoice,
              }
            : null
        }
        category={uploadTask?.photoshootType}
        onClose={() => closeUploadModal({ cancelled: true })}
        onUploadToDrive={runDriveUploadAndFinalize}
        onScheduleSocials={runSocialGridSchedule}
        onComplete={() => {
          setRefreshSignal((prev) => prev + 1);
          closeUploadModal();
        }}
      />

      {editingTaskId ? (
        <CreditNoteUploadModal
          open={isCreditNoteUploadOpen}
          taskId={editingTaskId}
          taskLabel={preservedTaskTitle || undefined}
          onClose={() => setIsCreditNoteUploadOpen(false)}
          onSuccess={({ creditNoteFileUrl: url }) => {
            setCreditNotePaid(true);
            setIsPaid(true);
            setCreditNoteFileUrl(url);
            setIsCreditNoteUploadOpen(false);
            setCreditNoteToast("Credit note uploaded to Lexoffice and marked as paid.");
            window.setTimeout(() => setCreditNoteToast(null), 4000);
          }}
        />
      ) : null}

      {creditNoteToast ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-6 left-1/2 z-[200] w-full max-w-md -translate-x-1/2 px-4"
        >
          <p className="rounded-xl border border-emerald-500/40 bg-emerald-950/95 px-5 py-3 text-center text-sm font-semibold text-emerald-100 shadow-2xl">
            {creditNoteToast}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}
