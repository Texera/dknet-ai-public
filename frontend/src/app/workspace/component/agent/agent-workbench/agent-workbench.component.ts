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

import { Component, HostListener, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from "@angular/core";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { NgFor, NgIf } from "@angular/common";
import { NzButtonComponent } from "ng-zorro-antd/button";
import { NzWaveDirective } from "ng-zorro-antd/core/wave";
import { ɵNzTransitionPatchDirective } from "ng-zorro-antd/core/transition-patch";
import { NzTooltipDirective } from "ng-zorro-antd/tooltip";
import { NzIconDirective } from "ng-zorro-antd/icon";
import { NzTabsComponent, NzTabBarExtraContentDirective, NzTabComponent, NzTabDirective } from "ng-zorro-antd/tabs";
import { AgentService, AgentInfo } from "../../../service/agent/agent.service";
import { AgentRegistrationComponent } from "../agent-panel/agent-registration/agent-registration.component";
import { AgentChatComponent } from "../agent-panel/agent-chat/agent-chat.component";

/**
 * The shared "inside" of every agent panel: a tab strip with a registration tab and
 * one tab per agent, each hosting a {@link AgentChatComponent}. It owns all the
 * agent-list / active-agent bookkeeping so the dock and float panels only have to
 * worry about their own chrome (positioning, collapse, resize).
 *
 * Both {@link AgentDockComponent} (dashboard) and {@link AgentFloatComponent}
 * (workspace) embed this component, so the chat UI is reused in both places.
 */
@UntilDestroy()
@Component({
  selector: "texera-agent-workbench",
  templateUrl: "agent-workbench.component.html",
  styleUrls: ["agent-workbench.component.scss"],
  imports: [
    NgIf,
    NgFor,
    NzButtonComponent,
    NzWaveDirective,
    ɵNzTransitionPatchDirective,
    NzTooltipDirective,
    NzIconDirective,
    NzTabsComponent,
    NzTabBarExtraContentDirective,
    NzTabComponent,
    NzTabDirective,
    AgentRegistrationComponent,
    AgentChatComponent,
  ],
})
export class AgentWorkbenchComponent implements OnInit, OnDestroy, OnChanges {
  /**
   * Optional agent ID to activate when the workbench loads. When provided (e.g. from
   * an agent dashboard deep link) the matching agent's tab is selected and activated.
   */
  @Input() agentIdToActivate?: string;

  // 0 = registration tab, 1+ = agent tabs.
  selectedTabIndex = 0;
  agents: AgentInfo[] = [];
  // Only one agent can be connected at a time.
  activeAgentId: string | null = null;

  constructor(private agentService: AgentService) {}

  ngOnInit(): void {
    this.agentService.agentChange$.pipe(untilDestroyed(this)).subscribe(() => {
      this.agentService
        .getAllAgents()
        .pipe(untilDestroyed(this))
        .subscribe(agents => {
          this.setAgents(agents);
          this.tryActivateAgentFromInput();
        });
    });

    this.agentService
      .getAllAgents()
      .pipe(untilDestroyed(this))
      .subscribe(agents => {
        this.setAgents(agents);
        this.tryActivateAgentFromInput();
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["agentIdToActivate"] && this.agentIdToActivate) {
      this.tryActivateAgentFromInput();
    }
  }

  @HostListener("window:beforeunload")
  ngOnDestroy(): void {
    this.deactivateCurrentAgent();
  }

  private tryActivateAgentFromInput(): void {
    if (!this.agentIdToActivate || this.agents.length === 0) {
      return;
    }

    const agentIndex = this.agents.findIndex(agent => agent.id === this.agentIdToActivate);
    if (agentIndex === -1) {
      return;
    }

    const agent = this.agents[agentIndex];
    if (this.activeAgentId) {
      this.agentService.deactivateAgent(this.activeAgentId);
    }
    this.activeAgentId = agent.id;
    this.agentService.activateAgent(agent.id);
    this.selectedTabIndex = agentIndex + 1; // +1 because tab 0 is registration

    // Clear so we don't re-activate on every change.
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

  /** Activates and switches to a newly created agent. */
  onAgentCreated(agentId: string): void {
    if (this.activeAgentId) {
      this.agentService.deactivateAgent(this.activeAgentId);
    }
    this.activeAgentId = agentId;
    this.agentService.activateAgent(agentId);

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

  onTabSelectChange(index: number): void {
    if (index === 0) {
      this.deactivateCurrentAgent();
      this.selectedTabIndex = 0;
      return;
    }

    const agentIndex = index - 1;
    if (agentIndex < 0 || agentIndex >= this.agents.length) {
      return;
    }
    this.switchToAgent(this.agents[agentIndex].id, index);
  }

  private switchToAgent(agentId: string, tabIndex: number): void {
    if (this.activeAgentId === agentId && this.selectedTabIndex === tabIndex) {
      return;
    }
    if (this.activeAgentId !== agentId) {
      this.deactivateCurrentAgent();
    }
    this.activeAgentId = agentId;
    this.agentService.activateAgent(agentId);
    this.selectedTabIndex = tabIndex;
  }

  private deactivateCurrentAgent(): void {
    if (this.activeAgentId) {
      this.agentService.deactivateAgent(this.activeAgentId);
      this.activeAgentId = null;
    }
  }

  deleteAgent(agentId: string, event: Event): void {
    event.stopPropagation(); // Prevent tab switch

    if (!confirm("Are you sure you want to delete this agent?")) {
      return;
    }

    const agentIndex = this.agents.findIndex(agent => agent.id === agentId);
    if (this.activeAgentId === agentId) {
      this.deactivateCurrentAgent();
    }

    this.agentService
      .deleteAgent(agentId)
      .pipe(untilDestroyed(this))
      .subscribe({
        next: () => {
          if (agentIndex !== -1 && this.selectedTabIndex === agentIndex + 1) {
            this.selectedTabIndex = 0;
          } else if (this.selectedTabIndex > agentIndex + 1) {
            this.selectedTabIndex--;
          }
        },
        error: (error: unknown) => {
          console.error("Failed to delete agent:", error);
        },
      });
  }
}
