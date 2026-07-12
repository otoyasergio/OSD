export {
  normalizeVin,
  validateVinFormat,
  validateOptionalVin,
  calculateCheckDigit,
  hasValidCheckDigit,
  isNorthAmericanVin,
  VIN_LENGTH,
  VIN_CHARSET,
  type VinValidationResult,
} from "@/lib/vin/validate";

export { decodeModelYearCode } from "@/lib/vin/year";
export { lookupWmi, type WmiHint } from "@/lib/vin/wmi";

export {
  decodeVin,
  parseVinLocal,
  summarizeDecode,
  type VinDecodeResult,
  type VinDecodeFields,
  type VinLocalParse,
} from "@/lib/vin/decode";
