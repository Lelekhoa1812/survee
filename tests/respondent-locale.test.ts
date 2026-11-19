import { describe, expect, it } from "vitest";
import { auditRespondentLocales, RESPONDENT_LOCALES, RESPONDENT_LOCALE_META, isRespondentLocale, resolveRespondentLocale, respondentBridgeMessages, respondentMessage, respondentMessageParts, respondentTime } from "../src/lib/respondent-locale";

describe("respondent shell locales", () => {
  it("uses a saved supported choice before browser preferences", () => {
    expect(resolveRespondentLocale("ar,en;q=0.8", "es")).toBe("es");
    expect(resolveRespondentLocale("ar,en;q=0.8", "fr")).toBe("ar");
  });

  it("maps supported language tags and falls back to Australian English", () => {
    expect(resolveRespondentLocale("vi-VN,es;q=0.8")).toBe("vi");
    expect(resolveRespondentLocale("es-MX,en;q=0.8")).toBe("es");
    expect(resolveRespondentLocale("ar-SA,en;q=0.8")).toBe("ar");
    expect(resolveRespondentLocale("fr-CA;q=1, es-MX;q=0.8, vi;q=0")).toBe("es");
    expect(resolveRespondentLocale("fr-CA,fr;q=0.8")).toBe("en-AU");
    expect(isRespondentLocale("ar")).toBe(true);
    expect(isRespondentLocale("ar-SA")).toBe(false);
  });

  it("keeps every bridge message available and applies right-to-left only to Arabic shell metadata", () => {
    expect(RESPONDENT_LOCALES).toEqual(["en-AU", "vi", "es", "ar"]);
    expect(RESPONDENT_LOCALE_META.ar).toMatchObject({ lang: "ar", direction: "rtl" });
    for (const locale of RESPONDENT_LOCALES) {
      const messages = respondentBridgeMessages(locale);
      expect(messages.rankMoveUp).toBeTruthy();
      expect(messages.rankMoveDown).toBeTruthy();
      expect(messages.rankConfirm).toBeTruthy();
      expect(messages.repeatAdd).toContain("{item}");
      expect(messages.repeatRemove).toContain("{index}");
      expect(messages.repeatRowAdded).toContain("{index}");
      expect(messages.lengthCount).toContain("{count}");
      expect(messages.requiredError).toBeTruthy();
    }
  });

  it("keeps every shell message complete and preserves interpolation placeholders across locales", () => {
    expect(auditRespondentLocales()).toEqual([]);
  });

  it("formats interpolated counts and save times with the selected locale", () => {
    expect(respondentMessage("es", "countAnswered", { answered: 1, total: 2 })).toBe("Respondidas 1 / 2");
    const timestamp = new Date("2026-11-19T13:05:00Z");
    expect(respondentTime("en-AU", timestamp)).toBe(new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit" }).format(timestamp));
    expect(respondentTime("ar", new Date("2026-11-19T13:05:00Z"))).toBeTruthy();
  });

  it("keeps authored question text isolated inside localized RTL shell messages", () => {
    expect(respondentMessageParts("ar", "lengthOver", { question: "English: What changed?", count: 22, max: 20 })).toEqual([
      { kind: "text", text: "تتكوّن الإجابة عن «" },
      { kind: "isolate", text: "English: What changed?" },
      { kind: "text", text: `» من ${new Intl.NumberFormat("ar").format(22)} حرفًا، والحد الأقصى هو ${new Intl.NumberFormat("ar").format(20)}. لم تُحفظ. اختصرها قبل المراجعة أو الإرسال.` },
    ]);
  });

  it("uses Arabic plural categories for selection limits", () => {
    expect(respondentMessage("ar", "maxSelections", { count: 0 })).toBe("لا تختر أي خيارات.");
    expect(respondentMessage("ar", "maxSelections", { count: 2 })).toBe("اختر خيارين كحد أقصى.");
    expect(respondentMessage("ar", "selectionMin", { count: 3 })).toBe(`اختر ${new Intl.NumberFormat("ar").format(3)} خيارات على الأقل أو اترك السؤال فارغًا.`);
    expect(respondentMessage("ar", "selectionMax", { count: 11 })).toBe(`اختر ${new Intl.NumberFormat("ar").format(11)} خيارًا كحد أقصى.`);
  });
});
