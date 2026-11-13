import type { AnswerMap, Manifest } from "../format/schema";

export type ExportFormat = "json" | "csv-wide" | "csv-long" | "xlsx" | "md";
export const EXPORT_FORMATS: ExportFormat[] = ["json", "csv-wide", "csv-long", "xlsx", "md"];

export type ParticipantStatus = "invited" | "in_progress" | "submitted";

export interface ExportParticipant {
  id: string;
  name: string;
  note?: string;
  status: ParticipantStatus;
  createdAt: string; // ISO
  lastSavedAt?: string; // ISO
  submittedAt?: string; // ISO
  answers: AnswerMap;
}

export interface ExportInput {
  interview: {
    id: string;
    name: string;
    description?: string;
    mode: "single" | "multi";
    status: "open" | "closed";
    createdAt: string; // ISO
  };
  /** The survey version the export is built against (the interview's current version). */
  manifest: Manifest;
  surveyVersion: number;
  participants: ExportParticipant[];
  generatedAt: string; // ISO
}

export interface ExportFile {
  filename: string;
  contentType: string;
  body: Buffer | string;
}
