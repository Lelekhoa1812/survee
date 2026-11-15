/**
 * A small strict JSON parser that remembers where every value starts, so a diagnostic can point at
 * `questions[3].options[1].value` on a real line and column, and a syntax error can say what was expected.
 * It rejects exactly what JSON.parse rejects (comments, trailing commas, single quotes, bare words).
 */
export interface JsonOk {
  ok: true;
  value: unknown;
  /** path (for example "questions[3].id") -> offset where that value starts. "" is the root. */
  starts: Map<string, number>;
  /** Same path -> offset immediately after its value. */
  ends: Map<string, number>;
  /** path of an object -> offset of each of its keys, for pointing at unknown fields. */
  keyStarts: Map<string, number>;
}
export interface JsonErr {
  ok: false;
  message: string;
  offset: number;
}

export function parseJsonWithPositions(text: string): JsonOk | JsonErr {
  const starts = new Map<string, number>();
  const ends = new Map<string, number>();
  const keyStarts = new Map<string, number>();
  let i = 0;

  class Fail extends Error {
    constructor(
      public offset: number,
      message: string,
    ) {
      super(message);
    }
  }

  const ws = () => {
    for (;;) {
      const c = text[i];
      if (c === " " || c === "\n" || c === "\r" || c === "\t") i++;
      else if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
        throw new Fail(i, "Comments are not allowed in JSON. Remove the comment (put explanations in the question's \"help\" instead)");
      } else break;
    }
  };

  const describe = (c: string | undefined) => (c === undefined ? "the end of the manifest" : c === "\n" ? "a line break" : `"${c}"`);

  const parseString = (): string => {
    const startQuote = text[i];
    if (startQuote === "'") throw new Fail(i, "Single quotes are not valid in JSON. Use double quotes around text");
    if (startQuote !== '"') throw new Fail(i, `Expected a double-quoted string, found ${describe(startQuote)}`);
    i++;
    let out = "";
    for (;;) {
      const c = text[i];
      if (c === undefined) throw new Fail(i, "Text is not closed: the manifest ended before the closing double quote");
      if (c === '"') {
        i++;
        return out;
      }
      if (c === "\n" || c === "\r") throw new Fail(i, "A line break inside text. Write \\n for a line break, or close the quote");
      if (c === "\\") {
        const n = text[i + 1];
        if (n === undefined) throw new Fail(i, "Text ends with a lone backslash");
        const simple: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (n in simple) {
          out += simple[n];
          i += 2;
        } else if (n === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Fail(i, "Invalid \\u escape: it needs four hexadecimal digits");
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else {
          throw new Fail(i, `Invalid escape "\\${n}". Inside text, a double quote is written \\" and a backslash is \\\\`);
        }
        continue;
      }
      if (c < " ") throw new Fail(i, "A control character inside text. Use \\n or \\t instead");
      out += c;
      i++;
    }
  };

  const parseValue = (path: string): unknown => {
    ws();
    starts.set(path, i);
    const c = text[i];
    if (c === "{") {
      i++;
      const obj: Record<string, unknown> = {};
      ws();
      if (text[i] === "}") {
        i++;
        ends.set(path, i);
        return obj;
      }
      for (;;) {
        ws();
        if (text[i] === "}") throw new Fail(i, 'Trailing comma: remove the comma before "}"');
        const keyAt = i;
        const key = parseString();
        keyStarts.set(path ? `${path}.${key}` : key, keyAt);
        ws();
        if (text[i] !== ":") throw new Fail(i, `Expected ":" after the key "${key}", found ${describe(text[i])}`);
        i++;
        obj[key] = parseValue(path ? `${path}.${key}` : key);
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          ends.set(path, i);
          return obj;
        }
        throw new Fail(i, `Expected "," or "}" after a value, found ${describe(text[i])}. A comma is probably missing between two entries`);
      }
    }
    if (c === "[") {
      i++;
      const arr: unknown[] = [];
      ws();
      if (text[i] === "]") {
        i++;
        ends.set(path, i);
        return arr;
      }
      for (;;) {
        ws();
        if (text[i] === "]") throw new Fail(i, 'Trailing comma: remove the comma before "]"');
        arr.push(parseValue(`${path}[${arr.length}]`));
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          ends.set(path, i);
          return arr;
        }
        throw new Fail(i, `Expected "," or "]" after a value, found ${describe(text[i])}. A comma is probably missing between two entries`);
      }
    }
    if (c === '"' || c === "'") {
      const value = parseString();
      ends.set(path, i);
      return value;
    }
    if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) {
      const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
      if (!m) throw new Fail(i, "Invalid number");
      i += m[0].length;
      const value = Number(m[0]);
      ends.set(path, i);
      return value;
    }
    for (const [word, val] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(word, i)) {
        i += word.length;
        ends.set(path, i);
        return val;
      }
    }
    if (c === undefined) throw new Fail(i, "The manifest ended while a value was expected");
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(text.slice(i))!;
      throw new Fail(i, `"${m[0]}" is not valid JSON here. Text must be in double quotes, and the only bare words are true, false and null`);
    }
    throw new Fail(i, `Unexpected ${describe(c)} where a value was expected`);
  };

  try {
    const value = parseValue("");
    ws();
    if (i < text.length) throw new Fail(i, `Unexpected ${describe(text[i])} after the end of the manifest`);
    return { ok: true, value, starts, ends, keyStarts };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, message: e.message, offset: e.offset };
    throw e;
  }
}
