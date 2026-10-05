import { useState, useId, useMemo } from 'react';
import * as Ariakit from '@ariakit/react';
import { useNavigate } from 'react-router-dom';
import { DropdownPopup, TooltipAnchor } from '@librechat/client';
import { LayoutGrid, MessageSquareText, ScrollText, MoreHorizontal } from 'lucide-react';
import type * as t from '~/common';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** "More tools" overflow menu in the chat header — navigation entries to the
 *  workspace tools that don't live in the Preview Rail (Agent Builder,
 *  Prompts, Skills). The full long-tail of features is in the Discover
 *  catalog (Ctrl+K); this is just the small handful worth one-clicking from
 *  within a chat. */
export default function MoreToolsMenu() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const menuId = useId();
  const [isOpen, setIsOpen] = useState(false);

  const items: t.MenuItemProps[] = useMemo(
    () => [
      {
        id: 'agent-builder',
        label: localize('com_atk_sb_agents'),
        icon: <LayoutGrid className="size-4" />,
        onClick: () => navigate('/agents'),
      },
      {
        id: 'prompts',
        label: localize('com_atk_sb_prompts'),
        icon: <MessageSquareText className="size-4" />,
        onClick: () => navigate('/prompts/new'),
      },
      {
        id: 'skills',
        label: localize('com_atk_sb_skills'),
        icon: <ScrollText className="size-4" />,
        onClick: () => navigate('/skills'),
      },
    ],
    [localize, navigate],
  );

  return (
    <DropdownPopup
      portal={true}
      menuId={menuId}
      focusLoop={true}
      isOpen={isOpen}
      unmountOnHide={true}
      setIsOpen={setIsOpen}
      keyPrefix="more-tools-"
      className="z-[125]"
      trigger={
        <TooltipAnchor
          description={localize('com_atk_more_tools')}
          render={
            <Ariakit.MenuButton
              id="more-tools-menu-button"
              aria-label={localize('com_atk_more_tools')}
              className={cn(
                'flex items-center justify-center size-9 rounded-lg border-none p-2',
                'text-text-primary transition hover:bg-surface-active-alt',
                'outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black dark:focus-visible:ring-white',
                isOpen ? 'bg-surface-hover' : '',
              )}
            >
              <MoreHorizontal className="icon-lg text-text-primary" aria-hidden="true" />
            </Ariakit.MenuButton>
          }
        />
      }
      items={items}
    />
  );
}
