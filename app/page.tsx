"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Select from "react-select";
import KanbanBoard, { type BoardTask } from "./components/KanbanBoard";
import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import { supabase } from "@/lib/supabaseClient";

type AmountType = "Net" | "Gross";
type PhotoshootType = "Real Estate" | "Business Portraits";
type ItemType = "Service" | "Product";

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

type ClientOption = SelectOption & {
  client: Client;
};

type CatalogOption = SelectOption & {
  name: string;
  defaultPrice: number;
  lexoffice_id: string | null;
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

export default function Home() {
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showArchiveView, setShowArchiveView] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [folderCreationNotice, setFolderCreationNotice] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [serviceCatalog, setServiceCatalog] = useState<CatalogItem[]>([]);
  const [productCatalog, setProductCatalog] = useState<CatalogItem[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [saveAsNewClient, setSaveAsNewClient] = useState(false);
  const [saveToClientAddressBook, setSaveToClientAddressBook] = useState(false);
  const [showCatalogModal, setShowCatalogModal] = useState(false);
  const [newCatalogType, setNewCatalogType] = useState<ItemType>("Service");
  const [newCatalogName, setNewCatalogName] = useState("");
  const [newCatalogPrice, setNewCatalogPrice] = useState(0);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTask, setUploadTask] = useState<BoardTask | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [contactFirstName, setContactFirstName] = useState("");
  const [contactLastName, setContactLastName] = useState("");
  const [street, setStreet] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [city, setCity] = useState("");
  const [lexofficeContactId, setLexofficeContactId] = useState("");
  const [country, setCountry] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [services, setServices] = useState<LineItem[]>([{ name: "", quantity: 1, price: 0, lexoffice_id: null }]);
  const [products, setProducts] = useState<LineItem[]>([{ name: "", quantity: 1, price: 0, lexoffice_id: null }]);
  const [taxPercentage, setTaxPercentage] = useState(19);
  const [amountType, setAmountType] = useState<AmountType>("Net");
  const [photoshootType, setPhotoshootType] = useState<PhotoshootType>("Real Estate");
  const [shootLocation, setShootLocation] = useState("");
  const [photoshootDate, setPhotoshootDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [discount, setDiscount] = useState(0);
  const [currentTaskStatus, setCurrentTaskStatus] = useState<BoardTask["status"]>("booking");
  const [localFolderNameDisplay, setLocalFolderNameDisplay] = useState("");
  const [openSections, setOpenSections] = useState({
    client: true,
    invoice: false,
    info: false,
  });
  const { isAdmin, isLoading: authRoleLoading } = useAuthRole();
  const [preservedTaskTitle, setPreservedTaskTitle] = useState("");

  useEffect(() => {
    if (authRoleLoading) {
      return;
    }
    if (!isAdmin) {
      setOpenSections({ client: false, invoice: false, info: true });
    }
  }, [authRoleLoading, isAdmin]);

  const clientOptions: ClientOption[] = clients.map((client) => ({
    value: client.id,
    label: client.company_name || "Unnamed Client",
    client,
  }));
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

  const getTaskTitle = (task: BoardTask) =>
    [task.photoshootType, task.companyName, task.shootLocation].filter(Boolean).join(" - ") || "Untitled";

  const calculateTaskPrice = (task: BoardTask) => {
    const serviceTotal = task.services.reduce((sum, row) => sum + row.quantity * row.price, 0);
    const productTotal = task.products.reduce((sum, row) => sum + row.quantity * row.price, 0);
    return serviceTotal + productTotal;
  };

  const loadReferenceData = async () => {
    if (!supabase) {
      return;
    }

    const [{ data: clientsData, error: clientsError }, { data: catalogData, error: catalogLoadError }] =
      await Promise.all([
        supabase
          .from("clients")
          .select("id, company_name, street, zip_code, city, lexoffice_contact_id")
          .order("company_name", { ascending: true }),
        supabase
          .from("catalog")
          .select("id, item_type, name, default_price, lexoffice_id")
          .order("name", { ascending: true }),
      ]);

    if (clientsError) {
      setFormError(`Failed to load clients: ${clientsError.message}`);
    } else {
      setClients((clientsData ?? []) as Client[]);
    }

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

  const resetForm = () => {
    setSelectedClientId("");
    setSaveAsNewClient(false);
    setSaveToClientAddressBook(false);
    setCompanyName("");
    setContactFirstName("");
    setContactLastName("");
    setStreet("");
    setZipCode("");
    setCity("");
    setLexofficeContactId("");
    setCountry("");
    setEmail("");
    setPhone("");
    setServices([{ name: "", quantity: 1, price: 0, lexoffice_id: null }]);
    setProducts([{ name: "", quantity: 1, price: 0, lexoffice_id: null }]);
    setTaxPercentage(19);
    setAmountType("Net");
    setPhotoshootType("Real Estate");
    setShootLocation("");
    setPhotoshootDate("");
    setDueDate("");
    setDiscount(0);
    setCurrentTaskStatus("booking");
    setLocalFolderNameDisplay("");
    setPreservedTaskTitle("");
    setFormError(null);
  };

  const closeModal = () => {
    setShowBookingModal(false);
    setEditingTaskId(null);
    setOpenSections({ client: true, invoice: false, info: false });
    resetForm();
  };

  const closeUploadModal = () => {
    setShowUploadModal(false);
    setUploadTask(null);
    setUploadFiles([]);
    setUploadError(null);
    setIsUploading(false);
  };

  const handleTaskMoved = (task: BoardTask, _from: string, to: string) => {
    if (to === "edited") {
      setUploadTask(task);
      setUploadFiles([]);
      setUploadError(null);
      setShowUploadModal(true);
    }
  };

  const openEditModal = (task: BoardTask) => {
    setEditingTaskId(task.id);
    setOpenSections({ client: true, invoice: false, info: false });
    setShowBookingModal(true);
    setFormError(null);
    setSelectedClientId("");
    setSaveAsNewClient(false);
    setCompanyName(task.companyName);
    setContactFirstName(task.contactFirstName);
    setContactLastName(task.contactLastName);
    setStreet(task.street);
    setZipCode(task.zipCode);
    setCity(task.city);
    setLexofficeContactId(task.lexofficeContactId ?? "");
    setCountry(task.country);
    setEmail(task.email);
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
    setShootLocation(task.shootLocation);
    setPhotoshootDate(task.photoshootDate);
    setDueDate(task.dueDate);
    setDiscount(task.discount);
    setCurrentTaskStatus(task.status);
    setLocalFolderNameDisplay(task.localFolderName ?? "");
    setPreservedTaskTitle(task.taskTitle?.trim() ?? "");
    void loadReferenceData();
  };

  const setSectionOpen = (section: "client" | "invoice" | "info") => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const contactName = [contactFirstName, contactLastName].filter(Boolean).join(" ").trim();

  const handleClientSelect = (clientId: string) => {
    setSelectedClientId(clientId);
    if (!clientId) {
      return;
    }

    const selected = clients.find((client) => client.id === clientId);
    if (!selected) {
      return;
    }

    setCompanyName(selected.company_name ?? "");
    setStreet(selected.street ?? "");
    setZipCode(selected.zip_code ?? "");
    setCity(selected.city ?? "");
    setLexofficeContactId(selected.lexoffice_contact_id ?? "");
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

  const createFoldersForTask = async (params: {
    taskId: string;
    title: string;
    address: string;
    date: string;
    clientName: string;
  }) => {
    try {
      const folderResponse = await fetch("/api/create-folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: params.taskId,
          title: params.title,
          address: params.address,
          date: params.date,
          client_name: params.clientName,
        }),
      });

      if (!folderResponse.ok) {
        const folderPayload = (await folderResponse.json().catch(() => null)) as { error?: string } | null;
        const msg =
          folderPayload?.error ??
          `Local folders could not be created (HTTP ${folderResponse.status}). Your booking was saved.`;
        console.error("[create-folders]", msg);
        setFolderCreationNotice(msg);
      }
    } catch (err) {
      console.error("[create-folders] Request failed:", err);
      setFolderCreationNotice(
        "Your booking was saved, but creating local folders failed (network error). Check the console or try again later."
      );
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

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
      setFormError("Company Name is required.");
      return;
    }

    setIsSubmitting(true);

    if (editingTaskId && !isAdmin) {
      const editorPayload = {
        photoshoot_type: photoshootType,
        shoot_location: shootLocation,
        photoshoot_date: photoshootDate,
        due_date: dueDate || null,
        title:
          preservedTaskTitle.trim() ||
          `${photoshootType} - ${companyName.trim() || "Client"}. - ${shootLocation}`,
        status: {
          booking: "Booking",
          "preview-sent": "Preview Sent",
          "selection-available": "Selection Available",
          editing: "Editing",
          edited: "Edited",
          "send-email": "Send Email",
          completed: "Completed",
        }[currentTaskStatus],
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
    const generatedTitle = `${photoshootType} - ${companyName}. - ${shootLocation}`;

    if (isAdmin && saveAsNewClient && !editingTaskId) {
      const { error: clientError } = await supabase.from("clients").insert({
        company_name: companyName,
        street,
        zip_code: zipCode,
        city,
        lexoffice_contact_id: lexofficeContactId || null,
      });

      if (clientError) {
        setIsSubmitting(false);
        setFormError(`Failed to save client: ${clientError.message}`);
        return;
      }
    }

    const payload = {
      company_name: companyName,
      contact_first_name: contactFirstName,
      contact_last_name: contactLastName,
      street,
      zip_code: zipCode,
      city,
      lexoffice_contact_id: lexofficeContactId || null,
      country,
      email,
      phone,
      services: selectedServices,
      products: selectedProducts,
      services_lexoffice_id: servicesLexofficeIds,
      products_lexoffice_id: productsLexofficeIds,
      tax_percentage: taxPercentage,
      amount_type: amountType,
      discount,
      photoshoot_type: photoshootType,
      shoot_location: shootLocation,
      photoshoot_date: photoshootDate,
      due_date: dueDate || null,
      status: editingTaskId
        ? {
            booking: "Booking",
            "preview-sent": "Preview Sent",
            "selection-available": "Selection Available",
            editing: "Editing",
            edited: "Edited",
            "send-email": "Send Email",
            completed: "Completed",
          }[currentTaskStatus]
        : "Booking",
      title: generatedTitle,
      client: companyName,
    };

    if (editingTaskId) {
      const { error } = await supabase.from("tasks").update(payload).eq("id", editingTaskId);
      setIsSubmitting(false);

      if (error) {
        setFormError(error.message);
        return;
      }
    } else {
      const { data: inserted, error } = await supabase
        .from("tasks")
        .insert({ ...payload, bracket_size: 3 })
        .select("id")
        .single();
      setIsSubmitting(false);

      if (error) {
        setFormError(error.message);
        return;
      }

      if (inserted?.id != null) {
        await createFoldersForTask({
          taskId: String(inserted.id),
          title: generatedTitle,
          address: shootLocation,
          date: photoshootDate,
          clientName: companyName,
        });
      }
    }

    if (isAdmin && editingTaskId && saveToClientAddressBook) {
      const { error: clientInsertError } = await supabase.from("clients").insert({
        company_name: companyName,
        street,
        zip_code: zipCode,
        city,
        lexoffice_contact_id: lexofficeContactId || null,
      });

      if (clientInsertError) {
        setFormError(`Task updated, but client save failed: ${clientInsertError.message}`);
        return;
      }
    }

    closeModal();
    setRefreshSignal((prev) => prev + 1);
    await loadReferenceData();
  };

  if (initialClientsLoad.current === null) {
    initialClientsLoad.current = loadReferenceData();
  }

  const handleUploadSubmit = async () => {
    if (!uploadTask) return;
    if (uploadFiles.length === 0) {
      setUploadError("Please select at least one file.");
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    const formData = new FormData();
    for (const file of uploadFiles) {
      formData.append("files", file);
    }

    const payload = {
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
      services: uploadTask.services,
      products: uploadTask.products,
      services_lexoffice_id: uploadTask.services.map(
        (s) => s.lexoffice_id ?? ""
      ),
      products_lexoffice_id: uploadTask.products.map(
        (p) => p.lexoffice_id ?? ""
      ),
    };

    console.log("ZAPIER PAYLOAD:", payload);

    formData.append("taskData", JSON.stringify(payload));

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let message = "Upload failed.";
        try {
          const errorPayload = (await response.json()) as { error?: string };
          if (errorPayload.error) message = errorPayload.error;
        } catch {}
        setUploadError(message);
        return;
      }

      if (!supabase) {
        setUploadError(
          "Files were saved, but Supabase is not configured — task status could not be set to Send Email."
        );
        return;
      }

      const { error: statusError } = await supabase
        .from("tasks")
        .update({ status: "Send Email" })
        .eq("id", uploadTask.id);

      if (statusError) {
        setUploadError(`Files uploaded, but status update failed: ${statusError.message}`);
        return;
      }

      setRefreshSignal((prev) => prev + 1);
      closeUploadModal();
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-8 font-sans dark:bg-black sm:px-6 lg:px-8">
      <main className="mx-auto w-full max-w-[1800px]">
        {folderCreationNotice ? (
          <div
            role="status"
            className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
          >
            <p className="min-w-0 flex-1 leading-snug">
              <span className="font-semibold">Folders not created. </span>
              {folderCreationNotice}
            </p>
            <button
              type="button"
              onClick={() => setFolderCreationNotice(null)}
              className="shrink-0 rounded px-2 py-0.5 text-amber-900 hover:bg-amber-100 dark:text-amber-50 dark:hover:bg-amber-900/50"
              aria-label="Dismiss notice"
            >
              Dismiss
            </button>
          </div>
        ) : null}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
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
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowArchiveView((prev) => !prev)}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              {showArchiveView ? "View Active Board" : "View Archive"}
            </button>
            {!authRoleLoading && isAdmin ? (
              <button
                type="button"
                onClick={() => {
                  setShowBookingModal(true);
                  setFormError(null);
                  void loadReferenceData();
                }}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-zinc-900 px-5 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Booking
              </button>
            ) : null}
          </div>
        </div>

        <KanbanBoard
          refreshSignal={refreshSignal}
          onTaskClick={openEditModal}
          onTaskMoved={handleTaskMoved}
          showArchived={showArchiveView}
        />
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
                    {editingTaskId ? (
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Select Existing Client
                        <div className="mt-1">
                          <Select<ClientOption, false>
                            isClearable
                            options={clientOptions}
                            value={clientOptions.find((option) => option.value === selectedClientId) ?? null}
                            onChange={(option) => handleClientSelect(option?.value ?? "")}
                            placeholder="Select a client (optional)"
                            styles={selectStyles}
                          />
                        </div>
                      </label>
                    ) : null}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Client Name
                        <input
                          required
                          value={companyName}
                          onChange={(event) => setCompanyName(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Company Name
                        <input
                          value={companyName}
                          onChange={(event) => setCompanyName(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>
                      <label className="sm:col-span-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Contact Name
                        <input
                          value={contactName}
                          onChange={(event) => {
                            const [first, ...rest] = event.target.value.trim().split(/\s+/);
                            setContactFirstName(first ?? "");
                            setContactLastName(rest.join(" "));
                          }}
                          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
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
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Street
                        <input
                          value={street}
                          onChange={(event) => setStreet(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Country
                        <input
                          value={country}
                          onChange={(event) => setCountry(event.target.value)}
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
                        <option value="Real Estate">Real Estate</option>
                        <option value="Business Portraits">Business Portraits</option>
                      </select>
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
                      Due Date
                      <input
                        type="date"
                        value={dueDate}
                        onChange={(event) => setDueDate(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                    </label>
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Lexoffice Contact ID
                      <input
                        value={lexofficeContactId}
                        onChange={(event) => setLexofficeContactId(event.target.value)}
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
                  </div>
                ) : null}
              </section>

              {formError ? <p className="text-sm text-red-600 dark:text-red-400">{formError}</p> : null}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || authRoleLoading}
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  {isSubmitting ? "Saving..." : editingTaskId ? "Save Changes" : "Create Booking"}
                </button>
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

      {showUploadModal ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900 sm:p-8">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Upload Photos</h3>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Add edited files for {uploadTask ? getTaskTitle(uploadTask) : "this task"}.
                </p>
              </div>
              <button
                type="button"
                onClick={closeUploadModal}
                className="rounded-md px-2 py-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                X
              </button>
            </div>

            <div
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const dropped = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
                if (dropped.length > 0) {
                  setUploadFiles((prev) => [...prev, ...dropped]);
                  setUploadError(null);
                }
              }}
              className="rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 p-8 text-center dark:border-zinc-700 dark:bg-zinc-800/60"
            >
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                Drag & drop image files here
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">or choose files manually</p>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={(event) => {
                  const selected = Array.from(event.target.files ?? []);
                  if (selected.length > 0) {
                    setUploadFiles((prev) => [...prev, ...selected]);
                    setUploadError(null);
                  }
                }}
                className="mt-4 block w-full text-sm text-zinc-700 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-zinc-700 dark:text-zinc-200 dark:file:bg-zinc-100 dark:file:text-zinc-900"
              />
            </div>

            <div className="mt-4 max-h-36 overflow-y-auto rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
              {uploadFiles.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">No files selected yet.</p>
              ) : (
                <ul className="space-y-1 text-sm text-zinc-700 dark:text-zinc-200">
                  {uploadFiles.map((file, index) => (
                    <li key={`${file.name}-${index}`}>{file.name}</li>
                  ))}
                </ul>
              )}
            </div>

            {uploadError ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{uploadError}</p> : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeUploadModal}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleUploadSubmit()}
                disabled={isUploading}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {isUploading ? "Uploading..." : "Complete & Send"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
