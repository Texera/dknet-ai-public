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

import { Component, HostBinding } from "@angular/core";
import { GuiConfigService } from "./common/service/gui-config.service";
import { NavigationEnd, Router } from "@angular/router";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { filter } from "rxjs";

@UntilDestroy()
@Component({
  selector: "texera-root",
  template: `
    <div
      *ngIf="!configLoaded"
      id="config-error">
      <h1>Configuration Error</h1>
      <p>Failed to load gui's configuration.</p>
      <p>Please ensure the ConfigService is running and accessible.</p>
      <button (click)="retry()">Retry</button>
    </div>
    <router-outlet *ngIf="configLoaded"></router-outlet>
    <texera-agent-panel
      *ngIf="shouldShowAgentPanel"
      (panelWidthChange)="onAgentPanelWidthChange($event)"></texera-agent-panel>
  `,
  standalone: false,
})
export class AppComponent {
  configLoaded = false;
  agentPanelReservedWidth = 0;
  private currentUrl = "";

  @HostBinding("style.--agent-panel-space")
  get agentPanelSpace(): string {
    return `${this.agentPanelReservedWidth}px`;
  }

  constructor(
    private config: GuiConfigService,
    private router: Router
  ) {
    // determine whether configuration was successfully loaded by APP_INITIALIZER
    try {
      // accessing env will throw if not loaded
      void this.config.env;
      this.configLoaded = true;
    } catch {
      this.configLoaded = false;
    }

    this.updateCurrentUrl(this.router.url);
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        untilDestroyed(this)
      )
      .subscribe(event => {
        this.updateCurrentUrl(event.urlAfterRedirects);
      });
  }

  retry(): void {
    window.location.reload();
  }

  get copilotEnabled(): boolean {
    return this.config.env.copilotEnabled;
  }

  get shouldShowAgentPanel(): boolean {
    return this.configLoaded && this.copilotEnabled && !this.isAboutPage(this.currentUrl);
  }

  onAgentPanelWidthChange(width: number): void {
    this.agentPanelReservedWidth = this.shouldShowAgentPanel ? width : 0;
    this.dispatchResizeAfterLayoutChange();
  }

  private updateCurrentUrl(url: string): void {
    this.currentUrl = url;
    if (!this.shouldShowAgentPanel) {
      this.agentPanelReservedWidth = 0;
      this.dispatchResizeAfterLayoutChange();
    }
  }

  private isAboutPage(url: string): boolean {
    return url === "/" || url.startsWith("/?") || url.startsWith("/dashboard/about");
  }

  private dispatchResizeAfterLayoutChange(): void {
    const resizeEvent = new Event("resize");
    window.dispatchEvent(resizeEvent);
    setTimeout(() => window.dispatchEvent(resizeEvent), 175);
  }
}
