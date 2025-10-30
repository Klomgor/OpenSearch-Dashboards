/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useRef, useState, useEffect, useImperativeHandle } from 'react';
import { EuiButtonIcon, EuiToolTip } from '@elastic/eui';
import { CoreStart, MountPoint, SIDECAR_DOCKED_MODE } from '../../../../core/public';
import { ChatWindow, ChatWindowInstance } from './chat_window';
import { ChatProvider } from '../contexts/chat_context';
import { ChatService } from '../services/chat_service';
import { GlobalAssistantProvider } from '../../../context_provider/public';
import { OpenSearchDashboardsContextProvider } from '../../../opensearch_dashboards_react/public';
import { ContextProviderStart, TextSelectionMonitor } from '../../../context_provider/public';
import './chat_header_button.scss';

export interface ChatHeaderButtonInstance {
  startNewConversation: ({ content }: { content: string }) => Promise<void>;
}

export enum ChatLayoutMode {
  SIDECAR = 'sidecar',
  FULLSCREEN = 'fullscreen',
}

interface ChatHeaderButtonProps {
  core: CoreStart;
  chatService: ChatService;
  contextProvider?: ContextProviderStart;
  charts?: any;
}

export const ChatHeaderButton = React.forwardRef<ChatHeaderButtonInstance, ChatHeaderButtonProps>(
  ({ core, chatService, contextProvider, charts }, ref) => {
    const [isOpen, setIsOpen] = useState(false);
    const [layoutMode, setLayoutMode] = useState<ChatLayoutMode>(ChatLayoutMode.SIDECAR);
    const sideCarRef = useRef<{ close: () => void }>();
    const mountPointRef = useRef<HTMLDivElement>(null);
    const chatWindowRef = useRef<ChatWindowInstance>(null);

    const openSidecar = useCallback(() => {
      if (!mountPointRef.current) return;

      const mountPoint: MountPoint = (element) => {
        if (mountPointRef.current) {
          element.appendChild(mountPointRef.current);
        }
        return () => {
          if (mountPointRef.current && element.contains(mountPointRef.current)) {
            element.removeChild(mountPointRef.current);
          }
        };
      };

      const sidecarConfig =
        layoutMode === ChatLayoutMode.FULLSCREEN
          ? {
              dockedMode: SIDECAR_DOCKED_MODE.TAKEOVER,
              paddingSize: window.innerHeight,
              isHidden: false,
            }
          : {
              dockedMode: SIDECAR_DOCKED_MODE.RIGHT,
              paddingSize: 400,
              isHidden: false,
            };

      sideCarRef.current = core.overlays.sidecar.open(mountPoint, {
        className: `chat-sidecar chat-sidecar--${layoutMode}`,
        config: sidecarConfig,
      });

      setIsOpen(true);
    }, [core.overlays, layoutMode]);

    const closeSidecar = useCallback(() => {
      if (sideCarRef.current) {
        sideCarRef.current.close();
        sideCarRef.current = undefined;
      }
      setIsOpen(false);
    }, []);

    const toggleSidecar = useCallback(() => {
      if (isOpen) {
        closeSidecar();
      } else {
        openSidecar();
      }
    }, [isOpen, openSidecar, closeSidecar]);

    const toggleLayoutMode = useCallback(() => {
      const newLayoutMode =
        layoutMode === ChatLayoutMode.SIDECAR ? ChatLayoutMode.FULLSCREEN : ChatLayoutMode.SIDECAR;

      setLayoutMode(newLayoutMode);

      // Update sidecar config dynamically if currently open
      if (isOpen && sideCarRef.current) {
        const newSidecarConfig =
          newLayoutMode === ChatLayoutMode.FULLSCREEN
            ? {
                dockedMode: SIDECAR_DOCKED_MODE.TAKEOVER,
                paddingSize: window.innerHeight - 50,
                isHidden: false,
              }
            : {
                dockedMode: SIDECAR_DOCKED_MODE.RIGHT,
                paddingSize: 400,
                isHidden: false,
              };

        core.overlays.sidecar.setSidecarConfig(newSidecarConfig);
      }
    }, [layoutMode, isOpen, core.overlays.sidecar]);

    const startNewConversation = useCallback<ChatHeaderButtonInstance['startNewConversation']>(
      async ({ content }) => {
        openSidecar();
        chatWindowRef.current?.startNewChat();
        chatWindowRef.current?.sendMessage({ content });
      },
      [openSidecar]
    );

    useImperativeHandle(ref, () => ({ startNewConversation }), [startNewConversation]);

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        if (sideCarRef.current) {
          sideCarRef.current.close();
        }
      };
    }, []);

    return (
      <>
        {/* Text selection monitor - always active when chat UI is rendered */}
        <TextSelectionMonitor />

        <EuiToolTip content="Open Chat Assistant">
          <EuiButtonIcon
            iconType="generate"
            onClick={toggleSidecar}
            color={isOpen ? 'primary' : 'subdued'}
            size="s"
            aria-label="Toggle chat assistant"
            display="empty"
          />
        </EuiToolTip>

        {/* Mount point for sidecar content */}
        <div
          ref={mountPointRef}
          className={`chatHeaderButton__mountPoint ${
            isOpen
              ? 'chatHeaderButton__mountPoint--visible'
              : 'chatHeaderButton__mountPoint--hidden'
          }`}
        >
          <div className="chatHeaderButton__content">
            <OpenSearchDashboardsContextProvider services={{ core, contextProvider, charts }}>
              <GlobalAssistantProvider
                onToolsUpdated={(tools) => {
                  // Tools updated in chat
                }}
              >
                <ChatProvider chatService={chatService}>
                  <ChatWindow
                    layoutMode={layoutMode}
                    onToggleLayout={toggleLayoutMode}
                    ref={chatWindowRef}
                  />
                </ChatProvider>
              </GlobalAssistantProvider>
            </OpenSearchDashboardsContextProvider>
          </div>
        </div>
      </>
    );
  }
);
