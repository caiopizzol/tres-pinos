// Pix copy-and-paste codes (EMV BR Code, Banco Central). Pure functions; no I/O.

export type PixCode =
  | {
      kind: "pix";
      valid: true;
      merchant: string | null;
      city: string | null;
      amount: string | null;
      dynamic: boolean;
      payload: string;
    }
  | { kind: "pix"; valid: false; error: "not_pix" | "crc" | "malformed" };

// CRC16/CCITT-FALSE as required by the Pix BR Code specification.
export function crc16(text: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function emvFields(payload: string): Record<string, string> | null {
  const fields: Record<string, string> = {};
  for (let i = 0; i < payload.length;) {
    const id = payload.slice(i, i + 2);
    const size = Number(payload.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || !Number.isInteger(size) || i + 4 + size > payload.length)
      return null;
    fields[id] = payload.slice(i + 4, i + 4 + size);
    i += 4 + size;
  }
  return fields;
}

// Validates the CRC; returns merchant and amount when present.
export function parsePix(payload: string): PixCode {
  const text = payload.trim();
  if (!text.startsWith("000201") || !/6304[0-9A-Fa-f]{4}$/.test(text)) {
    return { kind: "pix", valid: false, error: "not_pix" };
  }
  if (crc16(text.slice(0, -4)) !== text.slice(-4).toUpperCase()) {
    return { kind: "pix", valid: false, error: "crc" };
  }
  const fields = emvFields(text);
  if (!fields) return { kind: "pix", valid: false, error: "malformed" };
  const account = emvFields(fields["26"] ?? "") ?? {};
  return {
    kind: "pix",
    valid: true,
    merchant: fields["59"] ?? null,
    city: fields["60"] ?? null,
    amount: fields["54"] ?? null,
    dynamic: Boolean(account["25"]),
    payload: text,
  };
}

// Find Pix payloads in extracted text. PDF layout can wrap a payload across lines, and a
// merchant name can contain spaces, so try the text as printed and then without line breaks.
export function findPixCodes(text: string): PixCode[] {
  const seen = new Set<string>();
  const codes: PixCode[] = [];
  for (const candidate of [text, text.replace(/\s*\n\s*/g, "")]) {
    for (const match of candidate.matchAll(/000201[^\n]*?6304[0-9A-Fa-f]{4}/g)) {
      if (seen.has(match[0])) continue;
      const parsed = parsePix(match[0]);
      if (parsed.valid) {
        seen.add(match[0]);
        codes.push(parsed);
      }
    }
  }
  if (codes.length === 0 && /000201/.test(text))
    codes.push({ kind: "pix", valid: false, error: "crc" });
  return codes;
}
