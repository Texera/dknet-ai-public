/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import {
  Component,
  ViewChild,
  ElementRef,
  Input,
  OnInit,
  AfterViewChecked,
  ChangeDetectorRef,
  OnDestroy,
  OnChanges,
  SimpleChanges,
} from "@angular/core";
import { NavigationEnd, Router } from "@angular/router";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { Subject } from "rxjs";
import { distinctUntilChanged, filter, takeUntil } from "rxjs/operators";
import { AgentState, ReActStep } from "../../../../service/agent/agent-types";
import { AgentInfo, AgentService } from "../../../../service/agent/agent.service";
import { WorkflowActionService } from "../../../../service/workflow-graph/model/workflow-action.service";
import { NotificationService } from "../../../../../common/service/notification/notification.service";
import { ɵNzTransitionPatchDirective } from "ng-zorro-antd/core/transition-patch";
import { NzIconDirective } from "ng-zorro-antd/icon";
import { NzTooltipDirective } from "ng-zorro-antd/tooltip";
import { NzSpaceCompactItemDirective } from "ng-zorro-antd/space";
import { NzButtonComponent } from "ng-zorro-antd/button";
import { NgIf, NgFor } from "@angular/common";
import { MarkdownComponent } from "ngx-markdown";
import { NzSpinComponent } from "ng-zorro-antd/spin";
import { NzInputDirective, NzAutosizeDirective } from "ng-zorro-antd/input";
import { FormsModule } from "@angular/forms";
import { NzWaveDirective } from "ng-zorro-antd/core/wave";
import { ReActStepDetailModalComponent } from "../react-step-detail-modal/react-step-detail-modal.component";
import { ComputingUnitStatusService } from "../../../../../common/service/computing-unit/computing-unit-status/computing-unit-status.service";
import { DashboardWorkflowComputingUnit } from "../../../../../common/type/workflow-computing-unit";

interface WorkspaceContextBadge {
  workflowId: number;
  computingUnitId?: number;
  computingUnitName?: string;
  computingUnitStatus?: string;
}

@UntilDestroy()
@Component({
  selector: "texera-agent-chat",
  templateUrl: "agent-chat.component.html",
  styleUrls: ["agent-chat.component.scss"],
  imports: [
    ɵNzTransitionPatchDirective,
    NzIconDirective,
    NzTooltipDirective,
    NzSpaceCompactItemDirective,
    NzButtonComponent,
    NgIf,
    NgFor,
    MarkdownComponent,
    NzSpinComponent,
    NzInputDirective,
    FormsModule,
    NzAutosizeDirective,
    NzWaveDirective,
    ReActStepDetailModalComponent,
  ],
})
export class AgentChatComponent implements OnInit, AfterViewChecked, OnDestroy, OnChanges {
  @Input() agentInfo!: AgentInfo;
  @Input() isActive: boolean = false;
  @ViewChild("messageContainer", { static: false }) messageContainer?: ElementRef;
  @ViewChild("messageInput", { static: false }) messageInput?: ElementRef;

  /** All steps (for timeline rendering) */
  public agentResponses: ReActStep[] = [];
  /** Steps on the HEAD path only (for chat rendering) */
  public visibleSteps: ReActStep[] = [];
  public currentMessage = "";
  private shouldScrollToBottom = false;
  public isDetailsModalVisible = false;
  public selectedResponse: ReActStep | null = null;
  public hoveredMessageIndex: number | null = null;
  public agentState: AgentState = AgentState.UNAVAILABLE;
  public workspaceContextBadge: WorkspaceContextBadge | null = null;

  // Current HEAD step ID in the version tree
  public currentHeadId: string | null = null;

  // Subject to control workflow subscription lifecycle
  private stopWorkflowSubscription$ = new Subject<void>();
  private currentUrl = "";
  private selectedComputingUnit: DashboardWorkflowComputingUnit | null = null;

  constructor(
    private agentService: AgentService,
    private workflowActionService: WorkflowActionService,
    private notificationService: NotificationService,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private computingUnitStatusService: ComputingUnitStatusService
  ) {}

  ngOnInit(): void {
    if (!this.agentInfo) {
      return;
    }

    this.registerWorkspaceContextBadge();

    // Get the current state from manager service
    this.agentService
      .getAgentState(this.agentInfo.id)
      .pipe(untilDestroyed(this))
      .subscribe(state => {
        this.agentState = state;
        // Immediately trigger change detection to show the current state
        this.cdr.detectChanges();
      });

    // Then subscribe to agent state changes (BehaviorSubject will immediately emit current value)
    this.agentService
      .getAgentStateObservable(this.agentInfo.id)
      .pipe(untilDestroyed(this))
      .subscribe(state => {
        this.agentState = state;
        // Force immediate change detection
        this.cdr.detectChanges();
      });

    // Subscribe to ReActSteps
    this.agentService
      .getReActStepsObservable(this.agentInfo.id)
      .pipe(untilDestroyed(this))
      .subscribe(steps => {
        const previousLength = this.visibleSteps.length;
        this.agentResponses = steps;
        this.updateVisibleSteps();
        this.shouldScrollToBottom = true;

        // Automatically highlight the latest visible step
        if (this.visibleSteps.length > 0) {
          const latestIndex = this.visibleSteps.length - 1;
          const previousLatestIndex = previousLength - 1;

          if (
            this.hoveredMessageIndex === null ||
            this.hoveredMessageIndex === previousLatestIndex ||
            this.hoveredMessageIndex >= this.visibleSteps.length
          ) {
            this.setHoveredMessage(latestIndex);
          }
        }

        // Trigger change detection
        this.cdr.detectChanges();
      });

    // Subscribe to HEAD changes
    this.agentService
      .getHeadIdObservable(this.agentInfo.id)
      .pipe(untilDestroyed(this))
      .subscribe(headId => {
        this.currentHeadId = headId;
        this.updateVisibleSteps();
        this.cdr.detectChanges();
      });

    // Auto-persist is intentionally left enabled while the agent runs: the agent
    // streams its edits onto the canvas, and the frontend's normal auto-persist then
    // saves them to the backend (the single source of truth). The agent also persists
    // at task completion as a backstop.

    // Note: Workflow subscription is started/stopped via ngOnChanges based on isActive
    // This prevents automatic workflow switching when multiple agents are running

    // Start workflow subscription if already active
    if (this.isActive) {
      this.startWorkflowSubscription();
    }

    // Subscribe to scroll-to-step requests
    this.agentService.scrollToStep$.pipe(untilDestroyed(this)).subscribe(({ agentId, messageId, stepId }) => {
      if (agentId === this.agentInfo.id) {
        this.scrollToStep(messageId, stepId);
      }
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["isActive"]) {
      if (this.isActive) {
        this.startWorkflowSubscription();
      } else {
        this.stopWorkflowSubscription();
      }
    }
  }

  /**
   * Start subscribing to workflow changes from the agent.
   * Only called when this agent tab is active.
   */
  private startWorkflowSubscription(): void {
    if (!this.agentInfo) {
      return;
    }

    // Stop any existing subscription first
    this.stopWorkflowSubscription$.next();

    // Drive the canvas from genuine edits this agent makes (steps / version
    // checkouts) — NOT from a replayed snapshot or DB poll. This is why merely
    // switching to this tab no longer reloads (and used to wipe) the canvas.
    this.agentService
      .getWorkflowEditObservable(this.agentInfo.id)
      .pipe(
        distinctUntilChanged((prev, curr) => JSON.stringify(prev?.content) === JSON.stringify(curr?.content)),
        takeUntil(this.stopWorkflowSubscription$),
        untilDestroyed(this)
      )
      .subscribe(editedWorkflow => {
        // Never blank the canvas with an empty workflow.
        if ((editedWorkflow.content?.operators?.length ?? 0) === 0) {
          return;
        }
        // The agent edits only the workflow CONTENT. Preserve the current workflow's
        // metadata (id, name, ...) so the menu bar keeps the workflow name/id instead
        // of resetting to "Untitled workflow" with no id.
        const current = this.workflowActionService.getWorkflow();
        const merged = current ? { ...current, content: editedWorkflow.content } : editedWorkflow;
        this.workflowActionService.reloadWorkflow(merged, false, false);
      });
  }

  /**
   * Stop subscribing to workflow changes.
   * Called when switching away from this agent tab.
   */
  private stopWorkflowSubscription(): void {
    this.stopWorkflowSubscription$.next();
  }

  ngOnDestroy(): void {
    // Stop workflow subscription
    this.stopWorkflowSubscription$.next();
    this.stopWorkflowSubscription$.complete();
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  public setHoveredMessage(index: number | null): void {
    // When unhovered (null), automatically revert to latest step
    if (index === null && this.visibleSteps.length > 0) {
      index = this.visibleSteps.length - 1;
    }

    this.hoveredMessageIndex = index;
    const hoveredStep = index !== null && index >= 0 ? this.visibleSteps[index] : null;
    this.agentService.setHoveredMessage(this.agentInfo.id, hoveredStep);
  }

  public showResponseDetails(response: ReActStep): void {
    this.selectedResponse = response;
    this.isDetailsModalVisible = true;
  }

  public closeDetailsModal(): void {
    this.isDetailsModalVisible = false;
    this.selectedResponse = null;
  }

  public getToolResult(response: ReActStep, toolCallIndex: number): any {
    if (!response.toolResults || toolCallIndex >= response.toolResults.length) {
      return null;
    }
    const toolResult = response.toolResults[toolCallIndex];
    return toolResult.output || toolResult.result || toolResult;
  }

  public getToolOperatorAccess(
    response: ReActStep,
    toolCallIndex: number
  ): { viewedOperatorIds: string[]; modifiedOperatorIds: string[] } | null {
    if (!response.operatorAccess) {
      return null;
    }
    return response.operatorAccess.get(toolCallIndex) || null;
  }

  public hasOperatorAccess(response: ReActStep): boolean {
    return !!response.operatorAccess && response.operatorAccess.size > 0;
  }

  public sendMessage(): void {
    if (!this.currentMessage.trim() || !this.canSendMessage()) {
      return;
    }

    const userMessage = this.currentMessage.trim();
    this.currentMessage = "";

    // Fire-and-forget; responses stream in via the WebSocket subscription.
    this.agentService.sendMessage(this.agentInfo.id, userMessage);
  }

  /**
   * Check if messages can be sent (only when agent is available).
   */
  public canSendMessage(): boolean {
    return this.agentState === AgentState.AVAILABLE;
  }

  /**
   * Get the NG-ZORRO icon type based on current agent state.
   */
  public getStateIcon(): string {
    switch (this.agentState) {
      case AgentState.AVAILABLE:
        return "check-circle";
      case AgentState.GENERATING:
      case AgentState.STOPPING:
        return "sync";
      case AgentState.UNAVAILABLE:
      default:
        return "close-circle";
    }
  }

  /**
   * Get the icon color based on current agent state.
   */
  public getStateIconColor(): string {
    switch (this.agentState) {
      case AgentState.AVAILABLE:
        return "#52c41a";
      case AgentState.GENERATING:
      case AgentState.STOPPING:
        return "#1890ff";
      case AgentState.UNAVAILABLE:
      default:
        return "#ff4d4f";
    }
  }

  /**
   * Get the tooltip text for the state icon.
   */
  public getStateTooltip(): string {
    switch (this.agentState) {
      case AgentState.AVAILABLE:
        return "Agent is ready";
      case AgentState.GENERATING:
        return "Agent is generating response...";
      case AgentState.STOPPING:
        return "Agent is stopping...";
      case AgentState.UNAVAILABLE:
        return "Agent is unavailable";
      default:
        return "Agent status unknown";
    }
  }

  public onEnterPress(event: KeyboardEvent): void {
    if (!event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  private scrollToBottom(): void {
    if (this.messageContainer) {
      const element = this.messageContainer.nativeElement;
      element.scrollTop = element.scrollHeight;
    }
  }

  public stopGeneration(): void {
    this.agentService.stopGeneration(this.agentInfo.id);
  }

  public clearMessages(): void {
    this.agentService.clearMessages(this.agentInfo.id);
  }

  public getWorkspaceContextTooltip(): string {
    if (!this.workspaceContextBadge) {
      return "";
    }

    const workflowText = `workflow ID ${this.workspaceContextBadge.workflowId}`;
    if (this.workspaceContextBadge.computingUnitId === undefined) {
      return `Next message will include ${workflowText}. No computing unit is currently selected.`;
    }

    const unitName = this.workspaceContextBadge.computingUnitName
      ? ` (${this.workspaceContextBadge.computingUnitName})`
      : "";
    return `Next message will include ${workflowText} and computing unit ID ${this.workspaceContextBadge.computingUnitId}${unitName}.`;
  }

  private registerWorkspaceContextBadge(): void {
    this.currentUrl = this.router.url;
    this.refreshWorkspaceContextBadge();

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        untilDestroyed(this)
      )
      .subscribe(event => {
        this.currentUrl = event.urlAfterRedirects;
        this.refreshWorkspaceContextBadge();
      });

    this.workflowActionService
      .workflowMetaDataChanged()
      .pipe(untilDestroyed(this))
      .subscribe(() => {
        this.refreshWorkspaceContextBadge();
      });

    this.computingUnitStatusService
      .getSelectedComputingUnit()
      .pipe(untilDestroyed(this))
      .subscribe(unit => {
        this.selectedComputingUnit = unit;
        this.refreshWorkspaceContextBadge();
      });
  }

  private refreshWorkspaceContextBadge(): void {
    if (!this.isWorkspacePage(this.currentUrl)) {
      this.workspaceContextBadge = null;
      return;
    }

    const workflowId = this.getWorkspaceWorkflowId();
    if (workflowId === undefined) {
      this.workspaceContextBadge = null;
      return;
    }

    this.workspaceContextBadge = {
      workflowId,
      computingUnitId: this.selectedComputingUnit?.computingUnit.cuid,
      computingUnitName: this.selectedComputingUnit?.computingUnit.name,
      computingUnitStatus: this.selectedComputingUnit?.status,
    };
  }

  private getWorkspaceWorkflowId(): number | undefined {
    const routeWorkflowId = this.getRouteWorkflowId(this.currentUrl);
    if (routeWorkflowId !== undefined) {
      return routeWorkflowId;
    }

    const metadataWorkflowId = this.workflowActionService.getWorkflowMetadata()?.wid;
    return metadataWorkflowId !== undefined && metadataWorkflowId > 0 ? metadataWorkflowId : undefined;
  }

  private getRouteWorkflowId(url: string): number | undefined {
    const match = url.match(/^\/dashboard\/user\/workflow\/(\d+)(?:[/?#]|$)/);
    if (!match) {
      return undefined;
    }
    const workflowId = Number(match[1]);
    return Number.isFinite(workflowId) && workflowId > 0 ? workflowId : undefined;
  }

  private isWorkspacePage(url: string): boolean {
    return this.getRouteWorkflowId(url) !== undefined;
  }

  /**
   * Export the ReAct steps as a JSON file.
   * Fetches steps from the backend to get clean JSON (without Map objects).
   */
  public exportReActSteps(): void {
    if (this.visibleSteps.length === 0) {
      this.notificationService.warning("No ReAct steps to export");
      return;
    }

    this.agentService
      .getReActSteps(this.agentInfo.id)
      .pipe(untilDestroyed(this))
      .subscribe({
        next: (steps: ReActStep[]) => {
          // Convert steps to plain objects (handle Map -> object for operatorAccess)
          const exportSteps = steps.map(step => {
            const plain: any = { ...step };
            if (step.operatorAccess) {
              const accessObj: Record<string, any> = {};
              step.operatorAccess.forEach((value, key) => {
                accessObj[key] = value;
              });
              plain.operatorAccess = accessObj;
            }
            return plain;
          });

          const exportData = {
            agentId: this.agentInfo.id,
            agentName: this.agentInfo.name,
            modelType: this.agentInfo.modelType,
            exportedAt: new Date().toISOString(),
            stepCount: exportSteps.length,
            steps: exportSteps,
          };

          const jsonString = JSON.stringify(exportData, null, 2);
          const blob = new Blob([jsonString], { type: "application/json" });
          const url = URL.createObjectURL(blob);

          const link = document.createElement("a");
          link.href = url;
          link.download = `${this.agentInfo.name}-react-steps-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          URL.revokeObjectURL(url);

          this.notificationService.success(`Exported ${exportSteps.length} ReAct steps`);
        },
        error: (err: unknown) => {
          console.error("Failed to export ReAct steps:", err);
          this.notificationService.error("Failed to export ReAct steps");
        },
      });
  }

  public isGenerating(): boolean {
    return this.agentState === AgentState.GENERATING;
  }

  public isAvailable(): boolean {
    return this.agentState === AgentState.AVAILABLE;
  }

  public isConnected(): boolean {
    return this.agentState !== AgentState.UNAVAILABLE;
  }

  public isStopping(): boolean {
    return this.agentState === AgentState.STOPPING;
  }

  /**
   * Recompute visibleSteps: only steps on the ancestor path from root to HEAD.
   */
  private updateVisibleSteps(): void {
    if (!this.currentHeadId || this.agentResponses.length === 0) {
      this.visibleSteps = this.agentResponses;
      return;
    }
    const stepMap = new Map(this.agentResponses.map(s => [s.id, s]));
    const ancestorIds = new Set<string>();
    let current: string | undefined = this.currentHeadId;
    while (current) {
      ancestorIds.add(current);
      current = stepMap.get(current)?.parentId;
    }
    this.visibleSteps = this.agentResponses.filter(s => ancestorIds.has(s.id));
  }

  /**
   * Scroll chat messages to a specific step index.
   */
  private scrollToMessage(stepIndex: number): void {
    if (!this.messageContainer) {
      return;
    }

    const container = this.messageContainer.nativeElement;
    const messages = container.querySelectorAll(".message");

    if (stepIndex >= 0 && stepIndex < messages.length) {
      messages[stepIndex].scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  /**
   * Scroll to a specific step in the chat by messageId and stepId.
   */
  private scrollToStep(messageId: string, stepId: number): void {
    // Find the step index in visibleSteps
    const stepIndex = this.visibleSteps.findIndex(step => step.messageId === messageId && step.stepId === stepId);

    if (stepIndex >= 0) {
      this.scrollToMessage(stepIndex);
      // Highlight the message briefly
      this.setHoveredMessage(stepIndex);
    }
  }
}
