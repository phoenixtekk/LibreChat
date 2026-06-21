import { useMemo, useState } from 'react';
import { ChevronDown, ListChecks } from 'lucide-react';
import { ContentTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type LocalizeKey = Parameters<ReturnType<typeof useLocalize>>[0];

type StepSummary = {
  index: number;
  toolName: string;
  argSummary: string;
  outputSummary: string;
  hasError: boolean;
};

const MAX_ARG_CHARS = 80;
const MAX_OUTPUT_CHARS = 140;

function truncate(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return s.slice(0, max - 1) + '…';
}

function stringifyArgs(rawArgs: unknown): string {
  if (rawArgs == null) {
    return '';
  }
  if (typeof rawArgs === 'string') {
    return rawArgs;
  }
  if (typeof rawArgs === 'object') {
    try {
      const obj = rawArgs as Record<string, unknown>;
      const primary =
        (obj.code as string | undefined) ??
        (obj.command as string | undefined) ??
        (obj.query as string | undefined) ??
        (obj.input as string | undefined) ??
        (obj.path as string | undefined) ??
        (obj.filename as string | undefined);
      if (primary) {
        return primary;
      }
      return JSON.stringify(obj);
    } catch {
      return '';
    }
  }
  return String(rawArgs);
}

function stringifyOutput(output: unknown): string {
  if (output == null) {
    return '';
  }
  if (typeof output === 'string') {
    return output;
  }
  if (typeof output === 'object') {
    try {
      const obj = output as Record<string, unknown>;
      const primary =
        (obj.stdout as string | undefined) ??
        (obj.text as string | undefined) ??
        (obj.result as string | undefined) ??
        (obj.content as string | undefined);
      if (primary) {
        return primary;
      }
      return JSON.stringify(obj);
    } catch {
      return '';
    }
  }
  return String(output);
}

function looksErrorish(s: string): boolean {
  const t = s.toLowerCase();
  return (
    t.includes('traceback') ||
    t.includes('error:') ||
    t.includes('exception') ||
    t.includes('failed:')
  );
}

function collectSteps(parts: TMessageContentParts[]): StepSummary[] {
  const out: StepSummary[] = [];
  let index = 0;
  for (const part of parts) {
    if (!part || part.type !== ContentTypes.TOOL_CALL) {
      continue;
    }
    const tc = (part as unknown as { tool_call?: { name?: string; args?: unknown; output?: unknown } }).tool_call;
    if (!tc) {
      continue;
    }
    index += 1;
    const argSummary = truncate(stringifyArgs(tc.args).replace(/\s+/g, ' ').trim(), MAX_ARG_CHARS);
    const rawOutput = stringifyOutput(tc.output);
    const outputSummary = truncate(rawOutput.replace(/\s+/g, ' ').trim(), MAX_OUTPUT_CHARS);
    out.push({
      index,
      toolName: tc.name ?? 'tool',
      argSummary,
      outputSummary,
      hasError: looksErrorish(rawOutput),
    });
  }
  return out;
}

/** "What I just did" expander — sits under multi-step assistant messages.
 *  Default-collapsed. Click expands to a plain-English numbered list of
 *  every tool call in the message. Newcomers learn how the agent actually
 *  thinks; experienced users skip it entirely. */
export default function WhatIDidExpander({
  parts,
}: {
  parts: TMessageContentParts[] | undefined;
}) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);

  const steps = useMemo(() => collectSteps(parts ?? []), [parts]);

  if (steps.length < 2) {
    return null;
  }

  return (
    <div className="atk-what-i-did">
      <button
        type="button"
        className="atk-what-i-did-toggle"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <ListChecks size={12} aria-hidden="true" />
        <span>
          {open
            ? localize('com_atk_what_i_did_hide' as LocalizeKey)
            : localize('com_atk_what_i_did_show' as LocalizeKey, { 0: steps.length })}
        </span>
        <ChevronDown
          size={11}
          className={cn('transition-transform', open ? '' : '-rotate-90')}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ol className="atk-what-i-did-list">
          {steps.map((step) => (
            <li key={step.index} className="atk-what-i-did-step">
              <span className="atk-what-i-did-step-num">{step.index}.</span>
              <span className="atk-what-i-did-step-body">
                <span className="atk-what-i-did-step-tool">{step.toolName}</span>
                {step.argSummary && (
                  <code className="atk-what-i-did-step-args">{step.argSummary}</code>
                )}
                {step.outputSummary && (
                  <span
                    className={cn(
                      'atk-what-i-did-step-out',
                      step.hasError ? 'atk-what-i-did-step-err' : '',
                    )}
                  >
                    → {step.outputSummary}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
