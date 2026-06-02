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

import { Component, EventEmitter, OnDestroy, OnInit, Output } from "@angular/core";
import { AgentService, ModelType } from "../../../../service/agent/agent.service";
import { NotificationService } from "../../../../../common/service/notification/notification.service";
import { Subject, takeUntil } from "rxjs";
import { NgIf, NgFor } from "@angular/common";
import { NzSpinComponent } from "ng-zorro-antd/spin";
import { ɵNzTransitionPatchDirective } from "ng-zorro-antd/core/transition-patch";
import { NzIconDirective } from "ng-zorro-antd/icon";
import { NzSpaceCompactItemDirective } from "ng-zorro-antd/space";
import { NzInputDirective } from "ng-zorro-antd/input";
import { FormsModule } from "@angular/forms";
import { NzButtonComponent } from "ng-zorro-antd/button";
import { NzWaveDirective } from "ng-zorro-antd/core/wave";

@Component({
  selector: "texera-agent-registration",
  templateUrl: "agent-registration.component.html",
  styleUrls: ["agent-registration.component.scss"],
  imports: [
    NgIf,
    NzSpinComponent,
    ɵNzTransitionPatchDirective,
    NzIconDirective,
    NgFor,
    NzSpaceCompactItemDirective,
    NzInputDirective,
    FormsModule,
    NzButtonComponent,
    NzWaveDirective,
  ],
})
export class AgentRegistrationComponent implements OnInit, OnDestroy {
  @Output() agentCreated = new EventEmitter<string>();

  public modelTypes: ModelType[] = [];
  public selectedModelType: string | null = null;
  public customAgentName: string = "DKNet Agent";
  public isLoadingModels: boolean = false;
  public hasLoadingError: boolean = false;
  public isCreating: boolean = false;

  private destroy$ = new Subject<void>();

  constructor(
    private agentService: AgentService,
    private notificationService: NotificationService
  ) {}

  ngOnInit(): void {
    this.isLoadingModels = true;
    this.hasLoadingError = false;

    this.agentService
      .fetchModelTypes()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: models => {
          this.modelTypes = models;
          this.isLoadingModels = false;
          if (models.length === 0) {
            this.hasLoadingError = true;
            this.notificationService.error("No models available. Please check the LiteLLM configuration.");
          }
        },
        error: (error: unknown) => {
          this.isLoadingModels = false;
          this.hasLoadingError = true;
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.notificationService.error(`Failed to fetch models: ${errorMessage}`);
        },
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  public selectModelType(modelTypeId: string): void {
    this.selectedModelType = modelTypeId;
  }

  public createAgent(): void {
    if (!this.selectedModelType || this.isCreating) {
      return;
    }

    this.isCreating = true;

    this.agentService
      .createAgent(this.selectedModelType!, this.customAgentName || undefined)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: agentInfo => {
          this.agentCreated.emit(agentInfo.id);
          this.resetForm();
        },
        error: (error: unknown) => {
          this.notificationService.error(`Failed to create agent: ${error}`);
          this.isCreating = false;
        },
      });
  }

  private resetForm(): void {
    this.selectedModelType = null;
    this.customAgentName = "DKNet Agent";
    this.isCreating = false;
  }

  public canCreate(): boolean {
    return this.selectedModelType !== null && !this.isCreating;
  }
}
