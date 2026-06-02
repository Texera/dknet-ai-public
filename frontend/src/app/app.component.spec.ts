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

import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, NO_ERRORS_SCHEMA, Output } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { Router, NavigationEnd } from "@angular/router";
import { Subject } from "rxjs";

import { AppComponent } from "./app.component";
import { GuiConfigService } from "./common/service/gui-config.service";
import { MockGuiConfigService } from "./common/service/gui-config.service.mock";

@Component({
  selector: "texera-agent-panel",
  template: "",
  standalone: false,
})
class AgentPanelStubComponent {
  @Input() panelMode: "dock" | "float" = "dock";
  @Output() panelWidthChange = new EventEmitter<number>();
}

describe("AppComponent", () => {
  let fixture: ComponentFixture<AppComponent>;
  let configService: MockGuiConfigService;
  let routerEvents: Subject<NavigationEnd>;
  let routerMock: Partial<Router>;

  function build(url: string): void {
    routerEvents = new Subject<NavigationEnd>();
    routerMock = {
      url,
      events: routerEvents.asObservable(),
    };

    TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [AppComponent, AgentPanelStubComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: GuiConfigService, useClass: MockGuiConfigService },
        { provide: Router, useValue: routerMock },
      ],
    });

    configService = TestBed.inject(GuiConfigService) as unknown as MockGuiConfigService;
    configService.setConfig({ copilotEnabled: true });
    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
  }

  it("does not show the agent panel on the About page", () => {
    build("/");

    expect(fixture.debugElement.query(By.css("texera-agent-panel"))).toBeNull();
  });

  it("shows the agent panel on dashboard pages and reserves emitted width", () => {
    build("/dashboard/user/workflow");

    const agentPanel = fixture.debugElement.query(By.css("texera-agent-panel"));
    expect(agentPanel).toBeTruthy();
    expect(agentPanel.componentInstance.panelMode).toBe("dock");

    agentPanel.componentInstance.panelWidthChange.emit(480);
    fixture.detectChanges();

    expect(fixture.nativeElement.style.getPropertyValue("--agent-panel-space")).toBe("480px");
  });

  it("shows the floating agent panel on workspace pages without reserving dashboard width", () => {
    build("/dashboard/user/workflow/12");

    const agentPanel = fixture.debugElement.query(By.css("texera-agent-panel"));
    expect(agentPanel).toBeTruthy();
    expect(agentPanel.componentInstance.panelMode).toBe("float");

    agentPanel.componentInstance.panelWidthChange.emit(480);
    fixture.detectChanges();

    expect(fixture.nativeElement.style.getPropertyValue("--agent-panel-space")).toBe("0px");
  });

  it("clears the reserved dashboard width when navigating back to the About page", () => {
    build("/dashboard/user/workflow");

    const agentPanel = fixture.debugElement.query(By.css("texera-agent-panel"));
    agentPanel.componentInstance.panelWidthChange.emit(480);
    fixture.detectChanges();

    routerEvents.next(new NavigationEnd(1, "/dashboard/user/workflow", "/"));
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css("texera-agent-panel"))).toBeNull();
    expect(fixture.nativeElement.style.getPropertyValue("--agent-panel-space")).toBe("0px");
  });
});
