import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { SessionsListResult } from "../api/types.ts";
import { gatewayPresentationScope } from "../app/gateway-presentation-scope.ts";
import type { ApplicationGateway } from "../app/gateway.ts";
import { hasOperatorReadAccess } from "../app/operator-access.ts";
import {
  loadStoredSidebarSessionOwnerFilter,
  storeSidebarSessionOwnerFilter,
  type SidebarSessionOwnerFilter,
} from "./app-sidebar-session-types.ts";

type SessionOwnerFilterContext = {
  gateway: ApplicationGateway;
};

/** Owns the saved owner filter and invalidates changes to the effective list query. */
export class SessionOwnerFilterController implements ReactiveController {
  ownerId: string | null = null;
  involvingMe = false;
  private scope: string | null = null;
  private previous?: SidebarSessionOwnerFilter & { scope: string | null };
  private userIntent = false;
  private ownerFacet: { agentId: string; multiple: boolean } | null = null;

  constructor(
    private readonly host: ReactiveControllerHost & {
      isConnected: boolean;
      sidebarSessionOwnerFilter(): SidebarSessionOwnerFilter;
      sessionData: {
        resetSessionList(): void;
        refreshSidebarSessions(): Promise<void>;
        scheduleSidebarSessions(): Promise<void>;
      };
    },
    private readonly getContext: () => SessionOwnerFilterContext | undefined,
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    // Restore before SessionDataController subscribes its initial list; its queue
    // owns automatic reads while selected-chat startup remains unresolved.
    this.restore();
  }

  hostUpdate(): void {
    this.restore();
  }

  hostUpdated(): void {
    if (!this.host.isConnected) {
      return;
    }
    const previous = this.previous;
    const current = { ...this.host.sidebarSessionOwnerFilter(), scope: this.scope };
    this.previous = current;
    const userIntent = this.userIntent;
    this.userIntent = false;
    if (
      !previous ||
      previous.ownerId !== current.ownerId ||
      previous.involvingMe !== current.involvingMe ||
      previous.scope !== current.scope
    ) {
      if (previous) {
        this.host.sessionData.resetSessionList();
      }
      if (userIntent) {
        void this.host.sessionData.refreshSidebarSessions();
      } else {
        void this.host.sessionData.scheduleSidebarSessions();
      }
    }
  }

  hostDisconnected(): void {
    this.previous = undefined;
    this.userIntent = false;
  }

  hasMultipleOwners(agentId: string): boolean {
    this.restore();
    return this.ownerFacet?.agentId === agentId && this.ownerFacet.multiple;
  }

  observeOwnerFacet(agentId: string, owners: SessionsListResult["owners"]): void {
    this.restore();
    // Pending replacement rows must not reverse the query their owner inventory selected.
    if (owners !== undefined) {
      // Participants in filtered rows govern attribution UI, not query membership.
      // The complete owner facet stays authoritative when those rows disappear.
      const selfUserId = this.selfUserId;
      this.ownerFacet = {
        agentId,
        multiple: owners.some((owner) => owner.type !== "human" || owner.id !== selfUserId),
      };
    }
  }

  set(ownerId: string | null, involvingMe = false): void {
    this.restore();
    this.ownerId = involvingMe ? null : ownerId?.trim() || null;
    this.involvingMe = involvingMe;
    this.userIntent = true;
    const context = this.getContext();
    const selfUserId = this.selfUserId;
    if (context && selfUserId) {
      storeSidebarSessionOwnerFilter(context.gateway.connection.gatewayUrl, selfUserId, {
        ownerId: this.ownerId,
        involvingMe: this.involvingMe,
      });
    }
    this.host.requestUpdate();
  }

  private restore(): void {
    const context = this.getContext();
    const selfUserId = this.selfUserId;
    const auth = context?.gateway.snapshot.hello?.auth ?? null;
    const fallbackOwnerId =
      hasOperatorReadAccess(auth) && !auth?.sessionCap ? null : (selfUserId ?? null);
    const nextScope =
      context && selfUserId
        ? JSON.stringify([context.gateway.connection.gatewayUrl, selfUserId, fallbackOwnerId])
        : null;
    if (nextScope === this.scope) {
      return;
    }
    this.scope = nextScope;
    this.userIntent = false;
    this.ownerFacet = null;
    const stored =
      context && selfUserId
        ? loadStoredSidebarSessionOwnerFilter(
            context.gateway.connection.gatewayUrl,
            selfUserId,
            fallbackOwnerId,
          )
        : { ownerId: null, involvingMe: false };
    this.ownerId = stored.ownerId;
    this.involvingMe = stored.involvingMe;
    this.host.requestUpdate();
  }

  private get selfUserId(): string | undefined {
    const context = this.getContext();
    return context ? gatewayPresentationScope(context.gateway).displayUser?.id.trim() : undefined;
  }
}
