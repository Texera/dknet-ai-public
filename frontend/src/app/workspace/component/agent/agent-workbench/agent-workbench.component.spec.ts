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

import { Subject, of } from "rxjs";

import { AgentWorkbenchComponent } from "./agent-workbench.component";
import { AgentService, AgentInfo } from "../../../service/agent/agent.service";

function agent(id: string, name: string): AgentInfo {
  return { id, name, modelType: "gpt", isBaselineMode: false, createdAt: new Date(0) };
}

describe("AgentWorkbenchComponent", () => {
  let component: AgentWorkbenchComponent;
  let agentService: Partial<AgentService>;
  const agents = [agent("a1", "Agent One"), agent("a2", "Agent Two")];

  beforeEach(() => {
    agentService = {
      agentChange$: new Subject<void>(),
      getAllAgents: vi.fn().mockReturnValue(of(agents)),
      activateAgent: vi.fn(),
      deactivateAgent: vi.fn(),
      deleteAgent: vi.fn().mockReturnValue(of(true)),
    } as Partial<AgentService>;
    component = new AgentWorkbenchComponent(agentService as AgentService);
    component.ngOnInit();
  });

  afterEach(() => {
    component.ngOnDestroy();
  });

  it("loads agents on init", () => {
    expect(component.agents.length).toBe(2);
    expect(component.activeAgentId).toBeNull();
  });

  it("activates an agent when its tab is selected and switches back on the registration tab", () => {
    component.onTabSelectChange(1); // first agent tab
    expect(agentService.activateAgent).toHaveBeenCalledWith("a1");
    expect(component.activeAgentId).toBe("a1");
    expect(component.selectedTabIndex).toBe(1);

    component.onTabSelectChange(0); // registration tab
    expect(agentService.deactivateAgent).toHaveBeenCalledWith("a1");
    expect(component.activeAgentId).toBeNull();
    expect(component.selectedTabIndex).toBe(0);
  });

  it("deactivates the previous agent when switching to another", () => {
    component.onTabSelectChange(1);
    component.onTabSelectChange(2);
    expect(agentService.deactivateAgent).toHaveBeenCalledWith("a1");
    expect(agentService.activateAgent).toHaveBeenCalledWith("a2");
    expect(component.activeAgentId).toBe("a2");
    expect(component.selectedTabIndex).toBe(2);
  });

  it("activates and focuses a newly created agent", () => {
    component.onAgentCreated("a2");
    expect(agentService.activateAgent).toHaveBeenCalledWith("a2");
    expect(component.activeAgentId).toBe("a2");
    expect(component.selectedTabIndex).toBe(2); // +1 because tab 0 is registration
  });

  it("deletes an agent after confirmation", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const event = { stopPropagation: vi.fn() } as unknown as Event;

    component.deleteAgent("a1", event);

    expect(event.stopPropagation).toHaveBeenCalled();
    expect(agentService.deleteAgent).toHaveBeenCalledWith("a1");
    confirmSpy.mockRestore();
  });
});
