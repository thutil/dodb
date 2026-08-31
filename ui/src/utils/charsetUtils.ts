/**
 * Presets and helpers for database character sets, encodings, and collations.
 */

export interface CharsetCollationOption {
  collation: string;
  label: string;
  description?: string;
}

export interface CharsetOption {
  charset: string;
  label: string;
  description: string;
  defaultCollation: string;
  collations: CharsetCollationOption[];
}

export const MYSQL_CHARSETS: CharsetOption[] = [
  {
    charset: "utf8mb4",
    label: "utf8mb4 (Recommended)",
    description: "Full Unicode 4-byte UTF-8, supports all characters, emojis, and symbols",
    defaultCollation: "utf8mb4_unicode_ci",
    collations: [
      { collation: "utf8mb4_unicode_ci", label: "utf8mb4_unicode_ci (Recommended)", description: "Universal Unicode, case-insensitive" },
      { collation: "utf8mb4_0900_ai_ci", label: "utf8mb4_0900_ai_ci (MySQL 8.0+)", description: "Unicode 9.0 accent-insensitive, case-insensitive" },
      { collation: "utf8mb4_general_ci", label: "utf8mb4_general_ci", description: "Fast legacy general comparison" },
      { collation: "utf8mb4_bin", label: "utf8mb4_bin", description: "Binary case-sensitive exact match" },
      { collation: "utf8mb4_thai_520_w2", label: "utf8mb4_thai_520_w2", description: "Thai dictionary sorting & collation" },
    ],
  },
  {
    charset: "utf8mb3",
    label: "utf8mb3 / utf8 (Legacy 3-byte)",
    description: "Standard 3-byte UTF-8 (BMP only, no emoji)",
    defaultCollation: "utf8_general_ci",
    collations: [
      { collation: "utf8_general_ci", label: "utf8_general_ci" },
      { collation: "utf8_unicode_ci", label: "utf8_unicode_ci" },
      { collation: "utf8_bin", label: "utf8_bin" },
    ],
  },
  {
    charset: "latin1",
    label: "latin1 (Western European)",
    description: "ISO 8859-1 Western European",
    defaultCollation: "latin1_swedish_ci",
    collations: [
      { collation: "latin1_swedish_ci", label: "latin1_swedish_ci (MySQL default)" },
      { collation: "latin1_general_ci", label: "latin1_general_ci" },
      { collation: "latin1_bin", label: "latin1_bin" },
    ],
  },
  {
    charset: "ascii",
    label: "ascii (US ASCII)",
    description: "7-bit US ASCII",
    defaultCollation: "ascii_general_ci",
    collations: [
      { collation: "ascii_general_ci", label: "ascii_general_ci" },
      { collation: "ascii_bin", label: "ascii_bin" },
    ],
  },
  {
    charset: "binary",
    label: "binary",
    description: "Raw binary data without character translation",
    defaultCollation: "binary",
    collations: [{ collation: "binary", label: "binary" }],
  },
];

export const POSTGRES_ENCODINGS = [
  { encoding: "UTF8", label: "UTF8 (Recommended)", description: "Universal Unicode UTF-8" },
  { encoding: "LATIN1", label: "LATIN1", description: "ISO 8859-1 Western European" },
  { encoding: "SQL_ASCII", label: "SQL_ASCII", description: "Unspecified ASCII" },
  { encoding: "WIN1252", label: "WIN1252", description: "Windows CP1252" },
  { encoding: "EUC_JP", label: "EUC_JP", description: "Japanese EUC" },
];

export const POSTGRES_COLLATIONS = [
  { collation: "", label: "Default Server Collation" },
  { collation: "en_US.UTF-8", label: "en_US.UTF-8" },
  { collation: "C.UTF-8", label: "C.UTF-8" },
  { collation: "C", label: "C (Binary byte-order)" },
  { collation: "POSIX", label: "POSIX" },
];
