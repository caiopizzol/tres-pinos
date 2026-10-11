// FEBRABAN barcode codes: boleto (bank collection) and arrecadação (utilities and taxes),
// as 44-digit barcodes or their printed digitable lines. Pure functions; no I/O.

export type BoletoCode =
  | {
      kind: "boleto";
      valid: true;
      bank: string;
      currency: string;
      dueDate: string | null;
      amount: string | null;
      barcode: string;
      line?: string;
    }
  | {
      kind: "arrecadacao";
      valid: true;
      segment: string;
      amount: string | null;
      barcode: string;
      line?: string;
    }
  | {
      kind: "boleto" | "arrecadacao" | "unknown";
      valid: false;
      error: string;
      length?: number;
    };

const digitsOnly = (value: string) => value.replace(/\D/g, "");

// FEBRABAN module 10: weights 2,1,2,1... from the right; digits of each product are summed.
export function mod10(digits: string): number {
  let sum = 0;
  for (let i = digits.length - 1, weight = 2; i >= 0; i--, weight = 3 - weight) {
    const product = Number(digits[i]) * weight;
    sum += Math.floor(product / 10) + (product % 10);
  }
  const rest = sum % 10;
  return rest === 0 ? 0 : 10 - rest;
}

// Module 11 remainder with weights 2..9 from the right.
function mod11Rest(digits: string): number {
  let sum = 0;
  for (let i = digits.length - 1, weight = 2; i >= 0; i--, weight = weight === 9 ? 2 : weight + 1) {
    sum += Number(digits[i]) * weight;
  }
  return sum % 11;
}

// Boleto general digit: 0, 1 and 10 become 1.
export function boletoMod11(digits: string): number {
  const dv = 11 - mod11Rest(digits);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

// Arrecadação module 11: remainder 0 or 1 gives 0; 10 gives 1 (FEBRABAN layout v7).
export function arrecadacaoMod11(digits: string): number {
  const rest = mod11Rest(digits);
  if (rest === 0 || rest === 1) return 0;
  const dv = 11 - rest;
  return dv === 10 ? 1 : dv;
}

// Due-date factor: day 1000 is 2000-07-03 in the first cycle; the factor restarted at
// 1000 on 2025-02-22. Choose the cycle closest to the reference date.
export function dueDateFromFactor(factor: number, reference = new Date()): string | null {
  if (factor === 0) return null;
  const day = 86_400_000;
  const candidates = [Date.UTC(2000, 6, 3), Date.UTC(2025, 1, 22)].map(
    (base) => base + (factor - 1000) * day,
  );
  const ref = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
  const best = candidates.reduce((a, b) => (Math.abs(b - ref) < Math.abs(a - ref) ? b : a));
  return new Date(best).toISOString().slice(0, 10);
}

function amountFromCents(text: string): string | null {
  const cents = Number(text);
  return cents === 0 ? null : `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function boletoFromBarcode(barcode: string, reference?: Date): BoletoCode {
  const expected = boletoMod11(barcode.slice(0, 4) + barcode.slice(5));
  if (Number(barcode[4]) !== expected) {
    return { kind: "boleto", valid: false, error: "barcode_check_digit" };
  }
  return {
    kind: "boleto",
    valid: true,
    bank: barcode.slice(0, 3),
    currency: barcode.slice(3, 4),
    dueDate: dueDateFromFactor(Number(barcode.slice(5, 9)), reference),
    amount: amountFromCents(barcode.slice(9, 19)),
    barcode,
  };
}

// 47-digit digitable line → validated boleto.
export function parseBoletoLine(line: string, reference?: Date): BoletoCode {
  const fields: [number, number][] = [
    [0, 9],
    [10, 20],
    [21, 31],
  ];
  for (const [start, end] of fields) {
    if (mod10(line.slice(start, end)) !== Number(line[end])) {
      return { kind: "boleto", valid: false, error: "line_check_digit" };
    }
  }
  const barcode =
    line.slice(0, 4) +
    line.slice(32, 33) +
    line.slice(33, 47) +
    line.slice(4, 9) +
    line.slice(10, 20) +
    line.slice(21, 31);
  const result = boletoFromBarcode(barcode, reference);
  return result.valid ? { ...result, line } : result;
}

type CheckDigit = (digits: string) => number;

function arrecadacaoCheck(mode: string | undefined): CheckDigit | null {
  if (mode === "6" || mode === "7") return mod10;
  if (mode === "8" || mode === "9") return arrecadacaoMod11;
  return null;
}

// 44-digit arrecadação barcode (starts with 8).
function arrecadacaoFromBarcode(barcode: string): BoletoCode {
  const mode = barcode[2];
  const check = arrecadacaoCheck(mode);
  if (!check) return { kind: "arrecadacao", valid: false, error: "unknown_value_mode" };
  if (check(barcode.slice(0, 3) + barcode.slice(4)) !== Number(barcode[3])) {
    return { kind: "arrecadacao", valid: false, error: "barcode_check_digit" };
  }
  return {
    kind: "arrecadacao",
    valid: true,
    segment: barcode.slice(1, 2),
    amount: mode === "6" || mode === "8" ? amountFromCents(barcode.slice(4, 15)) : null,
    barcode,
  };
}

// 48-digit arrecadação line: four blocks of 11 digits plus one check digit each.
export function parseArrecadacaoLine(line: string): BoletoCode {
  const check = arrecadacaoCheck(line[2]);
  if (!check) return { kind: "arrecadacao", valid: false, error: "unknown_value_mode" };
  let barcode = "";
  for (let start = 0; start < 48; start += 12) {
    const data = line.slice(start, start + 11);
    if (check(data) !== Number(line[start + 11])) {
      return { kind: "arrecadacao", valid: false, error: "line_check_digit" };
    }
    barcode += data;
  }
  const result = arrecadacaoFromBarcode(barcode);
  return result.valid ? { ...result, line } : result;
}

// Classify one run of digits by length and prefix.
export function parseCode(value: string, reference?: Date): BoletoCode {
  const digits = digitsOnly(value);
  if (digits.length === 47) return parseBoletoLine(digits, reference);
  if (digits.length === 48 && digits[0] === "8") return parseArrecadacaoLine(digits);
  if (digits.length === 44) {
    return digits[0] === "8"
      ? arrecadacaoFromBarcode(digits)
      : boletoFromBarcode(digits, reference);
  }
  return {
    kind: "unknown",
    valid: false,
    error: "unsupported_length",
    length: digits.length,
  };
}

const LINE_PATTERNS = [
  /\b\d{5}[.\s]?\d{5}\s+\d{5}[.\s]?\d{6}\s+\d{5}[.\s]?\d{6}\s+\d\s+\d{14}\b/g, // boleto line
  /\b8\d{10}[-\s]?\d\s+\d{11}[-\s]?\d\s+\d{11}[-\s]?\d\s+\d{11}[-\s]?\d\b/g, // arrecadação line
  /\b\d{44,48}\b/g,
];

// Find every boleto and arrecadação code in extracted text; each is validated on its own.
export function findBoletos(text: string, reference?: Date): BoletoCode[] {
  const seen = new Set<string>();
  const codes: BoletoCode[] = [];
  for (const pattern of LINE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const digits = digitsOnly(match[0]);
      if (seen.has(digits) || ![44, 47, 48].includes(digits.length)) continue;
      seen.add(digits);
      codes.push(parseCode(digits, reference));
    }
  }
  return codes;
}
