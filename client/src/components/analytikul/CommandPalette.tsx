import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { SKINS, ACCENTS, applySkin, applyAccent, getSkin, getAccent } from './theme';

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * Analytikul command palette (Ctrl/Cmd+K) — Hermes Desktop-style keyboard-first
 * navigation. Hand-rolled (no cmdk dependency): overlay + filter input + list.
 */
export default function CommandPalette({
  onTogglePreviewRail,
  onOpenCosts,
}: {
  onTogglePreviewRail: () => void;
  onOpenCosts: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const localize = useLocalize();
  const { theme, setTheme } = useTheme();

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActive(0);
  }, []);

  const commands: Command[] = useMemo(() => {
    const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
    const list: Command[] = [
      {
        id: 'new-chat',
        label: localize('com_atk_new_chat'),
        hint: localize('com_atk_navigation'),
        run: () => navigate('/c/new'),
      },
      {
        id: 'toggle-preview-rail',
        label: localize('com_atk_toggle_preview_rail'),
        hint: localize('com_atk_panels'),
        run: onTogglePreviewRail,
      },
      {
        id: 'open-costs',
        label: localize('com_atk_open_costs'),
        hint: localize('com_atk_panels'),
        run: onOpenCosts,
      },
      {
        id: 'toggle-dark',
        label: localize(theme === 'dark' ? 'com_atk_switch_light' : 'com_atk_switch_dark'),
        hint: localize('com_atk_appearance'),
        run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      },
    ];
    for (const skin of SKINS) {
      list.push({
        id: `skin-${skin}`,
        label: `${localize('com_atk_skin')}: ${capitalize(skin)}`,
        hint: localize(getSkin() === skin ? 'com_atk_appearance_current' : 'com_atk_appearance'),
        run: () => applySkin(skin),
      });
    }
    for (const accent of ACCENTS) {
      list.push({
        id: `accent-${accent}`,
        label: `${localize('com_atk_accent')}: ${capitalize(accent)}`,
        hint: localize(
          getAccent() === accent ? 'com_atk_appearance_current' : 'com_atk_appearance',
        ),
        run: () => applyAccent(accent),
      });
    }
    return list;
  }, [localize, navigate, onTogglePreviewRail, onOpenCosts, setTheme, theme]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
      } else if (event.key === 'Escape' && open) {
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  if (!open) {
    return null;
  }

  const runCommand = (command: Command) => {
    command.run();
    close();
  };

  return (
    <>
      <div className="atk-command-palette-overlay" onClick={close} aria-hidden="true" />
      <div
        className="atk-command-palette"
        role="dialog"
        aria-label={localize('com_atk_palette_label')}
      >
        <input
          ref={inputRef}
          value={query}
          placeholder={localize('com_atk_palette_placeholder')}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((prev) => Math.min(prev + 1, filtered.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((prev) => Math.max(prev - 1, 0));
            } else if (event.key === 'Enter' && filtered[active]) {
              event.preventDefault();
              runCommand(filtered[active]);
            }
          }}
        />
        <div className="atk-command-palette-list" role="listbox">
          {filtered.length === 0 && (
            <div className="atk-command-item">
              <span>{localize('com_atk_no_commands')}</span>
            </div>
          )}
          {filtered.map((command, index) => (
            <button
              key={command.id}
              type="button"
              className="atk-command-item"
              data-active={index === active}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => runCommand(command)}
            >
              <span>{command.label}</span>
              {command.hint && <span className="atk-command-hint">{command.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
