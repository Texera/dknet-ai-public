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

import { AgentPanelComponent } from "./agent-panel.component";
import { AgentService } from "../../../service/agent/agent.service";

describe("AgentPanelComponent", () => {
  let component: AgentPanelComponent;
  let agentService: Partial<AgentService>;

  beforeEach(() => {
    localStorage.clear();
    agentService = {
      agentChange$: new Subject<void>(),
      getAllAgents: vi.fn().mockReturnValue(of([])),
      activateAgent: vi.fn(),
      deactivateAgent: vi.fn(),
    } as Partial<AgentService>;
    component = new AgentPanelComponent(agentService as AgentService);
  });

  it("emits reserved dashboard width when opened and clears it when closed", () => {
    const emittedWidths: number[] = [];
    component.panelWidthChange.subscribe(width => emittedWidths.push(width));

    component.openPanel();
    expect(component.width).toBe(400);
    expect(emittedWidths.at(-1)).toBe(400);

    component.openPanel();
    expect(component.width).toBe(0);
    expect(emittedWidths.at(-1)).toBe(0);
  });

  it("opens in floating mode without reserving dashboard width", () => {
    const emittedWidths: number[] = [];
    component.panelMode = "float";
    component.panelWidthChange.subscribe(width => emittedWidths.push(width));

    component.openPanel();

    expect(component.width).toBe(400);
    expect(emittedWidths.at(-1)).toBe(0);
  });
});
