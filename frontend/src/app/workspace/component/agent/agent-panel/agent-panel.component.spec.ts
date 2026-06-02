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
import { SimpleChange } from "@angular/core";

import { AgentPanelComponent } from "./agent-panel.component";
import { AgentService } from "../../../service/agent/agent.service";

describe("AgentPanelComponent", () => {
  let component: AgentPanelComponent;
  let agentService: Partial<AgentService>;
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    agentService = {
      agentChange$: new Subject<void>(),
      getAllAgents: vi.fn().mockReturnValue(of([])),
      activateAgent: vi.fn(),
      deactivateAgent: vi.fn(),
    } as Partial<AgentService>;
    component = new AgentPanelComponent(agentService as AgentService);
    requestAnimationFrameSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    requestAnimationFrameSpy.mockRestore();
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

  it("only updates width for docked resize events", () => {
    component.openPanel();
    const previousHeight = component.height;

    component.onResize({ width: 480, height: 620, direction: "bottomRight" });

    expect(component.width).toBe(480);
    expect(component.height).toBe(previousHeight);
    expect(component.dragPosition).toEqual({ x: 0, y: 0 });
    expect((component as any).dockResizeDirections).toEqual(["left"]);
  });

  it("opens in floating mode without reserving dashboard width", () => {
    const emittedWidths: number[] = [];
    component.panelMode = "float";
    component.panelWidthChange.subscribe(width => emittedWidths.push(width));

    component.openPanel();

    expect(component.width).toBe(400);
    expect(emittedWidths.at(-1)).toBe(0);
  });

  it("keeps full resize directions and updates width and height in floating mode", () => {
    component.panelMode = "float";
    component.openPanel();

    component.onResize({ width: 520, height: 620 });

    expect(component.width).toBe(520);
    expect(component.height).toBe(620);
    expect((component as any).floatingResizeDirections).toEqual([
      "left",
      "right",
      "top",
      "bottom",
      "topLeft",
      "topRight",
      "bottomLeft",
      "bottomRight",
    ]);
  });

  it("moves floating panel offset when resizing from right and bottom edges", () => {
    component.panelMode = "float";
    component.openPanel();
    component.dragPosition = { x: 5, y: 7 };
    component.height = 500;

    component.onResize({ width: 520, height: 620, direction: "bottomRight" });

    expect(component.width).toBe(520);
    expect(component.height).toBe(620);
    expect(component.dragPosition).toEqual({ x: 125, y: 127 });
  });

  it("keeps dock width independent from floating layout when switching modes", () => {
    const emittedWidths: number[] = [];
    component.panelWidthChange.subscribe(width => emittedWidths.push(width));

    component.openPanel();
    component.onResize({ width: 480 });

    component.panelMode = "float";
    component.ngOnChanges({ panelMode: new SimpleChange("dock", "float", false) });
    expect(component.width).toBe(400);
    expect(emittedWidths.at(-1)).toBe(0);

    component.onResize({ width: 620, height: 620 });
    expect(component.width).toBe(620);
    expect(component.height).toBe(620);

    component.panelMode = "dock";
    component.ngOnChanges({ panelMode: new SimpleChange("float", "dock", false) });
    expect(component.width).toBe(480);
    expect(emittedWidths.at(-1)).toBe(480);
  });
});
