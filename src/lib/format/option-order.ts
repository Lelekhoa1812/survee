/** Options that can be presented in a participant-specific, repeatable order. */
export interface OptionOrderInput<T extends { value: string }> {
  options: readonly T[];
  randomizeOptions: boolean;
  participantId: string;
  questionnaireVersion: string;
  questionId: string;
  /** Values whose authored positions must not move when other options are rotated. */
  fixedOptionValues?: readonly string[];
}

/**
 * Return a stable option order for one participant, immutable questionnaire version,
 * and question. Identity is used only as seed material and is never included in the
 * returned options. Fixed choices (for example, "Other" or "None") remain in their
 * authored slots while movable choices are shuffled into the remaining slots.
 */
export function orderOptions<T extends { value: string }>(input: OptionOrderInput<T>): T[] {
  const { options, randomizeOptions, fixedOptionValues = [] } = input;
  const ordered = [...options];
  if (!randomizeOptions || ordered.length < 2) return ordered;

  const fixed = new Set(fixedOptionValues);
  const slots: number[] = [];
  const movable: T[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const option = ordered[index];
    if (fixed.has(option.value)) continue;
    slots.push(index);
    movable.push(option);
  }

  const random = seededRandom(input.participantId, input.questionnaireVersion, input.questionId);
  for (let index = movable.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [movable[index], movable[swapIndex]] = [movable[swapIndex], movable[index]];
  }
  for (let index = 0; index < slots.length; index += 1) ordered[slots[index]] = movable[index];
  return ordered;
}

/** Small deterministic PRNG seeded from length-delimited JSON data; no ambient randomness. */
function seededRandom(participantId: string, questionnaireVersion: string, questionId: string): () => number {
  const seed = JSON.stringify([participantId, questionnaireVersion, questionId]);
  let h1 = 0xdeadbeef ^ seed.length;
  let h2 = 0x41c6ce57 ^ seed.length;
  let h3 = 0xc0decafe ^ seed.length;
  let h4 = 0x9e3779b9 ^ seed.length;
  for (let index = 0; index < seed.length; index += 1) {
    const code = seed.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x85ebca6b);
    h2 = Math.imul(h2 ^ code, 0xc2b2ae35);
    h3 = Math.imul(h3 ^ code, 0x27d4eb2f);
    h4 = Math.imul(h4 ^ code, 0x165667b1);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 0x7feb352d);
  h2 = Math.imul(h2 ^ (h2 >>> 15), 0x846ca68b);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 0x7feb352d);
  h4 = Math.imul(h4 ^ (h4 >>> 15), 0x846ca68b);

  // sfc32: all operations are defined 32-bit integer operations in JavaScript.
  let a = h1 >>> 0;
  let b = h2 >>> 0;
  let c = h3 >>> 0;
  let d = h4 >>> 0;
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const result = (a + b + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + result) | 0;
    return (result >>> 0) / 0x1_0000_0000;
  };
}
