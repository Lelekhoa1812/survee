function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Subject includes both, so mail clients do not thread every invite into one conversation. */
export function inviteSubject(name: string, title: string): string {
  const person = oneLine(name).slice(0, 80) || "there";
  const interview = oneLine(title).slice(0, 120) || "Interview";
  return `${person} — ${interview}`;
}

export interface InviteMessage {
  subject: string;
  text: string;
  html: string;
}

/**
 * Fixed template. The only personalised parts are the person's name, the interview title, and their private link.
 * The questionnaire HTML is never included.
 */
export function inviteMessage(name: string, title: string, link: string): InviteMessage {
  const person = oneLine(name).slice(0, 120) || "there";
  const interview = oneLine(title).slice(0, 200) || "your interview";
  const subject = inviteSubject(person, interview);
  const text = [
    `Hi ${person},`,
    "",
    `You have a private interview: ${interview}.`,
    "",
    "Open your link when you are ready:",
    link,
    "",
    "If you were not expecting this, you can ignore this message.",
  ].join("\n");
  const safeName = escapeHtml(person);
  const safeTitle = escapeHtml(interview);
  const safeLink = escapeHtml(link);
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;font-size:16px;line-height:1.5;color:#172033">
<p>Hi ${safeName},</p>
<p>You have a private interview: ${safeTitle}.</p>
<p><a href="${safeLink}">${safeLink}</a></p>
<p>If you were not expecting this, you can ignore this message.</p>
</body></html>`;
  return { subject, text, html };
}
