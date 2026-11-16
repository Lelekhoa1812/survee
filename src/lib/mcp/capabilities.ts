/** Capabilities granted to a named KQA MCP credential. */
export const MCP_CAPABILITIES = [
  "interviews:read",
  "analytics:read",
  "respondents:read",
  "respondents:manage",
  "interviews:manage",
  "questionnaires:manage",
  "assets:manage",
  "email:send",
  "email:check",
  "interviews:delete",
] as const;

export type McpCapability = (typeof MCP_CAPABILITIES)[number];

export const MCP_CAPABILITY_INFO: Record<McpCapability, { label: string; description: string }> = {
  "interviews:read": { label: "Interview setup", description: "List interviews, questionnaire files, versions, and static checks, and preview question edits." },
  "analytics:read": { label: "Aggregated analysis", description: "Read descriptive answer summaries and analytics guidance." },
  "respondents:read": { label: "Respondent details", description: "Read names, emails, private links, individual answers, exports, and event or mail status." },
  "respondents:manage": { label: "Manage respondents", description: "Add, edit, remove, reopen respondents, or regenerate private links." },
  "interviews:manage": { label: "Manage interviews", description: "Create, rename, open, or close interviews." },
  "questionnaires:manage": { label: "Publish questionnaires", description: "Upload or publish a new questionnaire version, including question block and requiredness changes." },
  "assets:manage": { label: "Manage images", description: "List, upload, rename, and delete workspace images used by questionnaires." },
  "email:send": { label: "Send invitations", description: "Send a private-link invitation email to one respondent." },
  "email:check": { label: "Check invitation delivery", description: "Check the stored invitation message ID and update its delivery status." },
  "interviews:delete": { label: "Delete interviews", description: "Permanently delete an interview and its associated records." },
};

/** New named API keys start with the least-privilege read workflow. */
export const DEFAULT_MCP_CAPABILITIES: readonly McpCapability[] = ["interviews:read", "analytics:read"];

/** Missing tool entries fail closed. Add a capability whenever a new tool is registered. */
export const MCP_TOOL_CAPABILITIES = {
  get_analytics_guidance: "analytics:read",
  get_design_guidance: "interviews:read",
  extract_design_profile: "interviews:read",
  audit_questionnaire_design: "interviews:read",
  list_interviews: "interviews:read",
  get_interview: "interviews:read",
  get_survey_html: "interviews:read",
  list_versions: "interviews:read",
  check_questionnaire: "interviews:read",
  preview_questionnaire_block_patch: "interviews:read",
  preview_questionnaire_required_patch: "interviews:read",
  list_people: "respondents:read",
  get_person: "respondents:read",
  get_answers: "respondents:read",
  analyze_answers: "analytics:read",
  get_status: "respondents:read",
  list_events: "respondents:read",
  export_interview: "respondents:read",
  get_mail_status: "respondents:read",
  create_interview: "interviews:manage",
  update_interview: "interviews:manage",
  delete_interview: "interviews:delete",
  preview_questionnaire_version_patch: "interviews:read",
  apply_questionnaire_version_patch: "questionnaires:manage",
  apply_questionnaire_block_patch: "questionnaires:manage",
  apply_questionnaire_required_patch: "questionnaires:manage",
  upload_survey_version: "questionnaires:manage",
  list_image_assets: "assets:manage",
  upload_image_asset: "assets:manage",
  update_image_asset: "assets:manage",
  delete_image_asset: "assets:manage",
  add_people: "respondents:manage",
  update_person: "respondents:manage",
  remove_person: "respondents:manage",
  reopen_person: "respondents:manage",
  regenerate_link: "respondents:manage",
  send_invite: "email:send",
  check_invite_delivery: "email:check",
} as const satisfies Record<string, McpCapability>;

export function isMcpCapability(value: unknown): value is McpCapability {
  return typeof value === "string" && (MCP_CAPABILITIES as readonly string[]).includes(value);
}

export function parseMcpCapabilities(value: unknown): McpCapability[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MCP_CAPABILITIES.length) return null;
  if (!value.every(isMcpCapability) || new Set(value).size !== value.length) return null;
  return [...value];
}

/** Undefined means an existing compatibility credential or the deployment token, which remains full access. */
export function canCallMcpTool(name: string, capabilities?: readonly McpCapability[]): boolean {
  const required = MCP_TOOL_CAPABILITIES[name as keyof typeof MCP_TOOL_CAPABILITIES];
  if (!required) return false;
  return capabilities === undefined || capabilities.includes(required);
}

export function capabilityLabel(capability: McpCapability): string {
  return MCP_CAPABILITY_INFO[capability].label;
}

export function describeCapabilities(capabilities?: readonly McpCapability[]): string {
  if (capabilities === undefined) return "Full access (legacy)";
  if (capabilities.length === MCP_CAPABILITIES.length && MCP_CAPABILITIES.every((capability) => capabilities.includes(capability))) return "All tools";
  return capabilities.map(capabilityLabel).join(", ") || "No tools";
}
