import type { AnswerMap, Manifest, RepeatRecordMap } from "../format/schema";
import type { QuestionOrderAssignmentView } from "../repo/types";

export type ExportFormat = "json" | "csv-wide" | "csv-long" | "csv-records" | "xlsx" | "md";
export const EXPORT_FORMATS: ExportFormat[] = ["json", "csv-wide", "csv-long", "csv-records", "xlsx", "md"];

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
  recordGroups?: RepeatRecordMap;
  questionOrderAssignments?: QuestionOrderAssignmentView[];
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
