export type ParsedCompanyAddress = {
  street: string;
  zip: string;
  city: string;
  countryCode: string;
};

const ZIP_CITY = /^(\d{4,5})\s+(.+)$/;

/**
 * Splits a free-text billing address into Lexoffice street, zip, and city.
 * Handles "Street 1, 58093 Hagen, DE" and newline forms like "Street 1\n58089 Hagen".
 */
export function parseCompanyAddress(raw: string | null | undefined): ParsedCompanyAddress {
  const text = (raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) {
    return { street: "", zip: "", city: "", countryCode: "" };
  }

  const parts = text
    .split(/\n+/)
    .flatMap((line) => line.split(","))
    .map((part) => part.trim())
    .filter(Boolean);

  let countryCode = "";
  const rest = [...parts];
  const last = rest[rest.length - 1];
  if (last && /^[A-Za-z]{2}$/.test(last)) {
    countryCode = last.toUpperCase();
    rest.pop();
  }

  const matches = rest
    .map((part, index) => ({ index, match: part.match(ZIP_CITY) }))
    .filter((entry): entry is { index: number; match: RegExpMatchArray } => entry.match !== null);
  const fiveDigit = matches.filter((entry) => (entry.match[1]?.length ?? 0) === 5);
  const chosen = (fiveDigit.length > 0 ? fiveDigit : matches).at(-1) ?? null;

  let zip = "";
  let city = "";
  const zipIndex = chosen?.index ?? -1;
  if (chosen) {
    zip = chosen.match[1] ?? "";
    city = (chosen.match[2] ?? "").trim();
  }

  const streetParts = zipIndex >= 0 ? rest.slice(0, zipIndex) : rest;
  if (!zip && !city && streetParts.length === 1) {
    return { street: "", zip: "", city: streetParts[0] ?? "", countryCode };
  }

  return {
    street: streetParts.join(", "),
    zip,
    city,
    countryCode,
  };
}
