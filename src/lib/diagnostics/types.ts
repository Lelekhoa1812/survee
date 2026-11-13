import type { Category, Severity } from "./catalog";
import type { Manifest } from "../format/schema";

export interface Location {
  /** 1-based line in the uploaded file. */
  line: number;
  /** 1-based column. */
  column: number;
  /** The offending source text (a start tag or a line), trimmed. */
  snippet?: string;
}

export interface Diagnostic {
  code: string;
  severity: Severity;
  category: Category;
  title: string;
  /** What is wrong in this instance, with the actual values found. */
  message: string;
  /** Exactly what to change in this instance. */
  fix: string;
  location?: Location;
  /** JSON path inside the manifest, for example questions[3].options[1].value. */
  path?: string;
  questionId?: string;
  /** A few source lines around the problem, with line numbers, for the AI report. */
  context?: string;
}

export interface CheckStats {
  bytes: number;
  lines: number;
  questions: number;
  sections: number;
  boundQuestions: number;
  customQuestions: number;
  requiredQuestions: number;
  scripts: number;
  externalResources: string[];
}

export interface Report {
  checkerVersion: string;
  formatVersion: string;
  fileName?: string;
  checkedAt: string;
  /** True when there are no errors. Warnings and info do not block. */
  ok: boolean;
  counts: { error: number; warning: number; info: number };
  diagnostics: Diagnostic[];
  stats: CheckStats;
  /** Present when the manifest parsed well enough to read. */
  manifest?: Manifest;
}

export const CHECKER_VERSION = "1.0.0";
