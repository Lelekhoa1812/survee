"use client";

import { CopyButton } from "./ui";

export function CopyBundle({ text }: { text: string }) {
  return <CopyButton className="btn primary sm" label="Copy everything for an AI agent" done="Copied" getText={() => text.replace("(this app)", `(${window.location.origin})`)} />;
}
