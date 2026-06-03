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

import { ChangeDetectorRef } from "@angular/core";
import { NavigationEnd, Router } from "@angular/router";
import { BehaviorSubject, EMPTY, Subject, of } from "rxjs";

import { ComputingUnitStatusService } from "../../../../../common/service/computing-unit/computing-unit-status/computing-unit-status.service";
import { DashboardWorkflowComputingUnit } from "../../../../../common/type/workflow-computing-unit";
import { NotificationService } from "../../../../../common/service/notification/notification.service";
import { AgentInfo, AgentService } from "../../../../service/agent/agent.service";
import { AgentState, ReActStep } from "../../../../service/agent/agent-types";
import { WorkflowActionService } from "../../../../service/workflow-graph/model/workflow-action.service";
import { AgentChatComponent } from "./agent-chat.component";

describe("AgentChatComponent", () => {
  let component: AgentChatComponent;
  let routerEvents: Subject<NavigationEnd>;
  let routerMock: Partial<Router>;
  let computingUnitSubject: BehaviorSubject<DashboardWorkflowComputingUnit | null>;
  let workflowMetadataSubject: Subject<void>;

  const agentInfo: AgentInfo = {
    id: "agent-1",
    name: "Agent 1",
    modelType: "gpt-test",
    isBaselineMode: false,
    createdAt: new Date(),
  };

  function build(url: string): void {
    routerEvents = new Subject<NavigationEnd>();
    routerMock = {
      url,
      events: routerEvents.asObservable(),
    };
    computingUnitSubject = new BehaviorSubject<DashboardWorkflowComputingUnit | null>(null);
    workflowMetadataSubject = new Subject<void>();

    const agentStateSubject = new BehaviorSubject<AgentState>(AgentState.AVAILABLE);
    const reactStepsSubject = new BehaviorSubject<ReActStep[]>([]);
    const headIdSubject = new BehaviorSubject<string | null>(null);

    component = new AgentChatComponent(
      {
        getAgentState: vi.fn(() => of(AgentState.AVAILABLE)),
        getAgentStateObservable: vi.fn(() => agentStateSubject.asObservable()),
        getReActStepsObservable: vi.fn(() => reactStepsSubject.asObservable()),
        getHeadIdObservable: vi.fn(() => headIdSubject.asObservable()),
        getInitializingObservable: vi.fn(() => of(false)),
        getWorkflowEditObservable: vi.fn(() => EMPTY),
        scrollToStep$: new Subject<{ agentId: string; messageId: string; stepId: number }>(),
        setHoveredMessage: vi.fn(),
      } as unknown as AgentService,
      {
        getWorkflowMetadata: vi.fn(() => ({ wid: undefined })),
        workflowMetaDataChanged: vi.fn(() => workflowMetadataSubject.asObservable()),
        reloadWorkflow: vi.fn(),
      } as unknown as WorkflowActionService,
      {
        warning: vi.fn(),
        error: vi.fn(),
        success: vi.fn(),
      } as unknown as NotificationService,
      {
        detectChanges: vi.fn(),
      } as unknown as ChangeDetectorRef,
      routerMock as Router,
      {
        getSelectedComputingUnit: vi.fn(() => computingUnitSubject.asObservable()),
      } as unknown as ComputingUnitStatusService
    );
    component.agentInfo = agentInfo;
    component.ngOnInit();
  }

  afterEach(() => {
    component.ngOnDestroy();
  });

  it("shows workspace context with workflow id and no computing unit before a unit is selected", () => {
    build("/dashboard/user/workflow/12");

    expect(component.workspaceContextBadge).toEqual({
      workflowId: 12,
      computingUnitId: undefined,
      computingUnitName: undefined,
      computingUnitStatus: undefined,
    });
    expect(component.getWorkspaceContextTooltip()).toContain("No computing unit is currently selected");
  });

  it("updates the badge when the selected computing unit changes", () => {
    build("/dashboard/user/workflow/12");

    computingUnitSubject.next({
      computingUnit: { cuid: 34, name: "Shared GPU" },
      status: "Running",
    } as DashboardWorkflowComputingUnit);

    expect(component.workspaceContextBadge).toMatchObject({
      workflowId: 12,
      computingUnitId: 34,
      computingUnitName: "Shared GPU",
      computingUnitStatus: "Running",
    });
    expect(component.getWorkspaceContextTooltip()).toContain("computing unit ID 34");
  });

  it("updates on workflow route changes and clears after leaving the workspace", () => {
    build("/dashboard/user/workflow/12");

    routerEvents.next(new NavigationEnd(1, "/dashboard/user/workflow/12", "/dashboard/user/workflow/45"));
    expect(component.workspaceContextBadge?.workflowId).toBe(45);

    routerEvents.next(new NavigationEnd(2, "/dashboard/user/workflow/45", "/dashboard/user/workflow"));
    expect(component.workspaceContextBadge).toBeNull();
  });
});
