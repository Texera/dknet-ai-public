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
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
} from "@angular/core";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import {
  type NzResizeDirection,
  NzResizeEvent,
  NzResizableDirective,
  NzResizeHandlesComponent,
} from "ng-zorro-antd/resizable";
import { AgentService, AgentInfo } from "../../../service/agent/agent.service";
import { NgIf, NgFor, NgTemplateOutlet } from "@angular/common";
import { NzSpaceCompactItemDirective } from "ng-zorro-antd/space";
import { NzButtonComponent } from "ng-zorro-antd/button";
import { NzWaveDirective } from "ng-zorro-antd/core/wave";
import { ɵNzTransitionPatchDirective } from "ng-zorro-antd/core/transition-patch";
import { NzTooltipDirective } from "ng-zorro-antd/tooltip";
import { NzIconDirective } from "ng-zorro-antd/icon";
import { CdkDrag, CdkDragEnd, CdkDragHandle } from "@angular/cdk/drag-drop";
import { NzMenuDirective, NzMenuItemComponent } from "ng-zorro-antd/menu";
import { NzTabsComponent, NzTabBarExtraContentDirective, NzTabComponent, NzTabDirective } from "ng-zorro-antd/tabs";
import { AgentRegistrationComponent } from "./agent-registration/agent-registration.component";
import { AgentChatComponent } from "./agent-chat/agent-chat.component";

@UntilDestroy()
@Component({
  selector: "texera-agent-panel",
  templateUrl: "agent-panel.component.html",
  styleUrls: ["agent-panel.component.scss"],
  imports: [
    NgIf,
    NgTemplateOutlet,
    NzSpaceCompactItemDirective,
    NzButtonComponent,
    NzWaveDirective,
    ɵNzTransitionPatchDirective,
    NzTooltipDirective,
    NzIconDirective,
    CdkDrag,
    NzResizableDirective,
    NzMenuDirective,
    NzMenuItemComponent,
    CdkDragHandle,
    NzTabsComponent,
    NzTabBarExtraContentDirective,
    NzTabComponent,
    NzTabDirective,
    AgentRegistrationComponent,
    NgFor,
    AgentChatComponent,
    NzResizeHandlesComponent,
  ],
})
export class AgentPanelComponent implements OnInit, OnDestroy, OnChanges {
  protected readonly window = window;
  protected readonly minPanelWidth = AgentPanelComponent.MIN_PANEL_WIDTH;
  protected readonly minPanelHeight = AgentPanelComponent.MIN_PANEL_HEIGHT;
  private static readonly MIN_PANEL_WIDTH = 400;
  private static readonly MIN_PANEL_HEIGHT = 450;
  private static readonly MAX_PANEL_WIDTH_RATIO = 0.65;
  private static readonly MAX_FLOAT_PANEL_WIDTH_RATIO = 0.9;
  private static readonly MAX_FLOAT_PANEL_HEIGHT_RATIO = 0.85;

  /**
   * Optional agent ID to activate when the panel loads.
   * When provided (from agent dashboard), the panel will open
   * and switch to this agent's tab automatically.
   */
  @Input() agentIdToActivate?: string;
  @Input() panelMode: "dock" | "float" = "dock";
  @Output() panelWidthChange = new EventEmitter<number>();

  // Panel width. A width of 0 means the right dock is collapsed.
  width: number = 0; // Start with 0 to show docked button
  height = Math.max(AgentPanelComponent.MIN_PANEL_HEIGHT, window.innerHeight * 0.7);
  private lastOpenDockWidth = AgentPanelComponent.MIN_PANEL_WIDTH;
  private lastOpenFloatWidth = AgentPanelComponent.MIN_PANEL_WIDTH;
  private lastOpenFloatHeight = Math.max(AgentPanelComponent.MIN_PANEL_HEIGHT, window.innerHeight * 0.7);
  private resizeAnimationFrameId = -1;
  dragPosition = { x: 0, y: 0 };

  // Tab management
  selectedTabIndex: number = 0; // 0 = registration tab, 1+ = agent tabs
  agents: AgentInfo[] = [];

  // Active agent tracking - only one agent can be connected at a time
  activeAgentId: string | null = null;

  constructor(private agentService: AgentService) {}

  get isOpen(): boolean {
    return this.width > 0;
  }

  get isFloatingMode(): boolean {
    return this.panelMode === "float";
  }

  protected get maxPanelWidth(): number {
    return Math.max(
      AgentPanelComponent.MIN_PANEL_WIDTH,
      Math.floor(this.window.innerWidth * AgentPanelComponent.MAX_PANEL_WIDTH_RATIO)
    );
  }

  protected get maxFloatingPanelWidth(): number {
    return Math.max(
      AgentPanelComponent.MIN_PANEL_WIDTH,
      Math.floor(this.window.innerWidth * AgentPanelComponent.MAX_FLOAT_PANEL_WIDTH_RATIO)
    );
  }

  protected get maxPanelHeight(): number {
    return Math.max(
      AgentPanelComponent.MIN_PANEL_HEIGHT,
      Math.floor(this.window.innerHeight * AgentPanelComponent.MAX_FLOAT_PANEL_HEIGHT_RATIO)
    );
  }

  protected get dockResizeDirections(): NzResizeDirection[] {
    return ["left"];
  }

  protected get floatingResizeDirections(): NzResizeDirection[] {
    return ["left", "right", "top", "bottom", "topLeft", "topRight", "bottomLeft", "bottomRight"];
  }

  protected get currentMaxPanelWidth(): number {
    return this.isFloatingMode ? this.maxFloatingPanelWidth : this.maxPanelWidth;
  }

  ngOnInit(): void {
    this.loadPanelSettings();

    // Subscribe to agent changes
    this.agentService.agentChange$.pipe(untilDestroyed(this)).subscribe(() => {
      this.agentService
        .getAllAgents()
        .pipe(untilDestroyed(this))
        .subscribe(agents => {
          this.setAgents(agents);
          // Try to activate the agent if agentIdToActivate is set
          this.tryActivateAgentFromInput();
        });
    });

    // Load initial agents
    this.agentService
      .getAllAgents()
      .pipe(untilDestroyed(this))
      .subscribe(agents => {
        this.setAgents(agents);
        // Try to activate the agent if agentIdToActivate is set
        this.tryActivateAgentFromInput();
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["agentIdToActivate"] && this.agentIdToActivate) {
      this.tryActivateAgentFromInput();
    }
    if (changes["panelMode"]) {
      this.applyPanelModeLayout();
    }
  }

  /**
   * Try to activate the agent specified by agentIdToActivate input.
   * Opens the panel and switches to the agent's tab.
   */
  private tryActivateAgentFromInput(): void {
    if (!this.agentIdToActivate || this.agents.length === 0) {
      return;
    }

    const agentIndex = this.agents.findIndex(agent => agent.id === this.agentIdToActivate);
    if (agentIndex === -1) {
      return;
    }

    // Open the panel if it's closed
    if (!this.isOpen) {
      this.setPanelWidth(this.currentLastOpenWidth);
    }

    // Switch to the agent's tab and activate it
    const agent = this.agents[agentIndex];

    // Deactivate previous agent if any
    if (this.activeAgentId) {
      this.agentService.deactivateAgent(this.activeAgentId);
    }

    // Activate the specified agent
    this.activeAgentId = agent.id;
    this.agentService.activateAgent(agent.id);
    this.selectedTabIndex = agentIndex + 1; // +1 because tab 0 is registration

    // Clear the input so we don't re-activate on every change
    this.agentIdToActivate = undefined;
  }

  private setAgents(agents: AgentInfo[]): void {
    this.agents = agents;

    if (this.activeAgentId && !agents.some(agent => agent.id === this.activeAgentId)) {
      this.deactivateCurrentAgent();
    }

    if (this.selectedTabIndex > agents.length) {
      this.selectedTabIndex = 0;
    }
  }

  @HostListener("window:beforeunload")
  ngOnDestroy(): void {
    cancelAnimationFrame(this.resizeAnimationFrameId);
    // Deactivate any active agent before destroying
    this.deactivateCurrentAgent();
    this.savePanelSettings();
  }

  /**
   * Open the panel from docked state
   */
  public openPanel(): void {
    if (!this.isOpen) {
      if (this.isFloatingMode) {
        this.height = this.lastOpenFloatHeight;
      }
      this.setPanelWidth(this.currentLastOpenWidth);
    } else {
      this.setPanelWidth(0);
    }
  }

  /**
   * Handle agent creation - activates and switches to the new agent
   */
  public onAgentCreated(agentId: string): void {
    // Deactivate previous agent if any
    if (this.activeAgentId) {
      this.agentService.deactivateAgent(this.activeAgentId);
    }

    // Set the new agent as active immediately
    this.activeAgentId = agentId;
    this.agentService.activateAgent(agentId);

    // Fetch the latest agent list and switch to the new agent's tab
    this.agentService
      .getAllAgents()
      .pipe(untilDestroyed(this))
      .subscribe(agents => {
        this.setAgents(agents);
        const agentIndex = agents.findIndex(agent => agent.id === agentId);
        if (agentIndex !== -1) {
          this.selectedTabIndex = agentIndex + 1; // +1 because tab 0 is registration
        }
      });
  }

  public onTabSelectChange(index: number): void {
    if (index === 0) {
      this.deactivateCurrentAgent();
      this.selectedTabIndex = 0;
      return;
    }

    const agentIndex = index - 1;
    if (agentIndex < 0 || agentIndex >= this.agents.length) {
      return;
    }

    const agent = this.agents[agentIndex];
    this.switchToAgent(agent.id, index);
  }

  /**
   * Switch to a specific agent tab
   */
  private switchToAgent(agentId: string, tabIndex: number): void {
    // Skip if already on this agent and tab
    if (this.activeAgentId === agentId && this.selectedTabIndex === tabIndex) {
      return;
    }

    // Deactivate previous agent only if switching to a different agent
    if (this.activeAgentId !== agentId) {
      this.deactivateCurrentAgent();
    }

    // Activate new agent
    this.activeAgentId = agentId;
    this.agentService.activateAgent(agentId);
    this.selectedTabIndex = tabIndex;
  }

  /**
   * Deactivate the currently active agent
   */
  private deactivateCurrentAgent(): void {
    if (this.activeAgentId) {
      this.agentService.deactivateAgent(this.activeAgentId);
      this.activeAgentId = null;
    }
  }

  /**
   * Delete an agent
   */
  public deleteAgent(agentId: string, event: Event): void {
    event.stopPropagation(); // Prevent tab switch

    if (confirm("Are you sure you want to delete this agent?")) {
      const agentIndex = this.agents.findIndex(agent => agent.id === agentId);

      // Deactivate if this is the active agent
      if (this.activeAgentId === agentId) {
        this.deactivateCurrentAgent();
      }

      // Must subscribe to the observable for it to execute
      this.agentService
        .deleteAgent(agentId)
        .pipe(untilDestroyed(this))
        .subscribe({
          next: () => {
            // If we're on the deleted agent's tab, switch to registration
            if (agentIndex !== -1 && this.selectedTabIndex === agentIndex + 1) {
              this.selectedTabIndex = 0;
            } else if (this.selectedTabIndex > agentIndex + 1) {
              // Adjust selected index if we deleted a tab before the current one
              this.selectedTabIndex--;
            }
          },
          error: (error: unknown) => {
            console.error("Failed to delete agent:", error);
          },
        });
    }
  }

  /**
   * Handle panel resize
   */
  onResize({ width, height }: NzResizeEvent): void {
    if (width === undefined && height === undefined) {
      return;
    }
    cancelAnimationFrame(this.resizeAnimationFrameId);
    this.resizeAnimationFrameId = requestAnimationFrame(() => {
      if (width !== undefined) {
        this.setPanelWidth(width);
      }
      if (this.isFloatingMode && height !== undefined) {
        this.height = this.clampPanelHeight(height);
        this.lastOpenFloatHeight = this.height;
        this.savePanelSettings();
      }
    });
  }

  onDragEnded(event: CdkDragEnd): void {
    this.dragPosition = event.source.getFreeDragPosition();
    this.savePanelSettings();
  }

  /**
   * Load panel settings from localStorage
   */
  private loadPanelSettings(): void {
    const legacyWidth = localStorage.getItem("agent-panel-width");
    const savedDockWidth = localStorage.getItem("agent-panel-dock-width") ?? legacyWidth;
    const savedFloatWidth = localStorage.getItem("agent-panel-float-width") ?? legacyWidth;
    const savedHeight = localStorage.getItem("agent-panel-float-height") ?? localStorage.getItem("agent-panel-height");
    const savedDragX = localStorage.getItem("agent-panel-float-drag-x") ?? localStorage.getItem("agent-panel-drag-x");
    const savedDragY = localStorage.getItem("agent-panel-float-drag-y") ?? localStorage.getItem("agent-panel-drag-y");

    if (savedDockWidth) {
      const parsedDockWidth = Number(savedDockWidth);
      if (!isNaN(parsedDockWidth)) {
        this.lastOpenDockWidth = this.clampPanelWidth(parsedDockWidth, this.maxPanelWidth);
      }
    }
    if (savedFloatWidth) {
      const parsedFloatWidth = Number(savedFloatWidth);
      if (!isNaN(parsedFloatWidth)) {
        this.lastOpenFloatWidth = this.clampPanelWidth(parsedFloatWidth, this.maxFloatingPanelWidth);
      }
    }
    if (savedHeight) {
      const parsedHeight = Number(savedHeight);
      if (!isNaN(parsedHeight)) {
        this.lastOpenFloatHeight = this.clampPanelHeight(parsedHeight);
        this.height = this.lastOpenFloatHeight;
      }
    }
    const parsedDragX = Number(savedDragX);
    const parsedDragY = Number(savedDragY);
    if (!isNaN(parsedDragX) && !isNaN(parsedDragY)) {
      this.dragPosition = { x: parsedDragX, y: parsedDragY };
    }
  }

  /**
   * Save panel settings to localStorage
   */
  private savePanelSettings(): void {
    localStorage.setItem("agent-panel-dock-width", String(this.lastOpenDockWidth));
    localStorage.setItem("agent-panel-float-width", String(this.lastOpenFloatWidth));
    localStorage.setItem("agent-panel-float-height", String(this.lastOpenFloatHeight));
    localStorage.setItem("agent-panel-float-drag-x", String(this.dragPosition.x));
    localStorage.setItem("agent-panel-float-drag-y", String(this.dragPosition.y));
    localStorage.removeItem("agent-panel-width");
    localStorage.removeItem("agent-panel-height");
    localStorage.removeItem("agent-panel-drag-x");
    localStorage.removeItem("agent-panel-drag-y");
    localStorage.removeItem("agent-panel-style");
    localStorage.removeItem("agent-panel-docked");
  }

  private setPanelWidth(width: number): void {
    this.width = width === 0 ? 0 : this.clampPanelWidth(width, this.currentMaxPanelWidth);
    if (this.isOpen) {
      if (this.isFloatingMode) {
        this.lastOpenFloatWidth = this.width;
      } else {
        this.lastOpenDockWidth = this.width;
      }
    }
    this.savePanelSettings();
    this.emitPanelWidth();
    window.dispatchEvent(new Event("resize"));
  }

  private emitPanelWidth(): void {
    this.panelWidthChange.emit(this.isFloatingMode ? 0 : this.width);
  }

  private applyPanelModeLayout(): void {
    if (this.isOpen) {
      if (this.isFloatingMode) {
        this.height = this.lastOpenFloatHeight;
      }
      this.setPanelWidth(this.currentLastOpenWidth);
      return;
    }
    this.emitPanelWidth();
  }

  private get currentLastOpenWidth(): number {
    return this.isFloatingMode ? this.lastOpenFloatWidth : this.lastOpenDockWidth;
  }

  private clampPanelWidth(width: number, maxWidth: number): number {
    return Math.min(Math.max(Math.round(width), AgentPanelComponent.MIN_PANEL_WIDTH), maxWidth);
  }

  private clampPanelHeight(height: number): number {
    return Math.min(Math.max(Math.round(height), AgentPanelComponent.MIN_PANEL_HEIGHT), this.maxPanelHeight);
  }
}
