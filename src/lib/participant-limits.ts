/** Bounds shared by host, API, and MCP participant workflows. */
export const MAX_PARTICIPANTS_PER_READ = 100;
/** Maximum aggregate BSON payload hydrated for one buffered answer export. */
export const MAX_EXPORT_SOURCE_BYTES = 8 * 1024 * 1024;
/** Maximum people accepted in one atomic add-people request. */
export const MAX_PEOPLE_PER_BATCH = 100;
export const DEFAULT_PARTICIPANT_PAGE_SIZE = 50;
export const MAX_PARTICIPANT_PAGE_SIZE = 100;
