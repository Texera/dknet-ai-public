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

import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { NzButtonModule } from "ng-zorro-antd/button";
import { NzCardModule } from "ng-zorro-antd/card";
import { NzModalModule, NzModalService } from "ng-zorro-antd/modal";
import { NzInputModule } from "ng-zorro-antd/input";
import { NzMessageService } from "ng-zorro-antd/message";
import { NzIconModule } from "ng-zorro-antd/icon";
import { NzTagModule } from "ng-zorro-antd/tag";
import { NzTooltipModule } from "ng-zorro-antd/tooltip";
import { NzEmptyModule } from "ng-zorro-antd/empty";
import { WorkflowComputingUnitManagingService } from "../../../../common/service/computing-unit/workflow-computing-unit/workflow-computing-unit-managing.service";
import { DashboardWorkflowComputingUnit } from "../../../../common/type/workflow-computing-unit";
import { AuthService } from "../../../../common/service/user/auth.service";

@UntilDestroy()
@Component({
  selector: "texera-user-biomcp",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzButtonModule,
    NzCardModule,
    NzModalModule,
    NzInputModule,
    NzIconModule,
    NzTagModule,
    NzTooltipModule,
    NzEmptyModule,
  ],
  templateUrl: "./user-biomcp.component.html",
  styleUrls: ["./user-biomcp.component.scss"],
})
export class UserBiomcpComponent implements OnInit {
  sessions: DashboardWorkflowComputingUnit[] = [];
  loading = false;
  createModalOpen = false;
  creating = false;
  newName = "";

  constructor(
    private cuService: WorkflowComputingUnitManagingService,
    private modal: NzModalService,
    private message: NzMessageService
  ) {}

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.cuService
      .listComputingUnits()
      .pipe(untilDestroyed(this))
      .subscribe({
        next: units => {
          this.sessions = units.filter(u => u.computingUnit.type === "biomcp");
          this.loading = false;
        },
        error: (e: unknown) => {
          this.loading = false;
          this.message.error(`Failed to load sessions: ${(e as Error)?.message ?? e}`);
        },
      });
  }

  openCreateModal(): void {
    this.newName = "";
    this.createModalOpen = true;
  }

  cancelCreate(): void {
    if (this.creating) return;
    this.createModalOpen = false;
  }

  submitCreate(): void {
    const name = this.newName.trim();
    if (!name) {
      this.message.warning("Session name is required");
      return;
    }
    this.creating = true;
    this.cuService
      .createBioMcpComputingUnit(name)
      .pipe(untilDestroyed(this))
      .subscribe({
        next: () => {
          this.creating = false;
          this.createModalOpen = false;
          this.message.success(`BioMCP session "${name}" submitted`);
          this.refresh();
        },
        error: (e: unknown) => {
          this.creating = false;
          this.message.error(`Create failed: ${(e as any)?.error?.message ?? (e as Error)?.message ?? e}`);
        },
      });
  }

  // Build the public per-session URL and open it in a new tab. The access
  // token rides as a query param on the very first hit; the access-control
  // proxy then mints a /biomcp-scoped cookie so the rest of the webapp's
  // sub-resource fetches authenticate without re-passing it in URLs.
  openSession(unit: DashboardWorkflowComputingUnit): void {
    if (unit.status !== "Running") {
      this.message.warning("Session is not ready yet — wait until status is Running");
      return;
    }
    const token = AuthService.getAccessToken();
    if (!token) {
      this.message.error("You appear to be logged out. Please sign in again.");
      return;
    }
    const url = `${window.location.origin}/biomcp/${unit.computingUnit.cuid}/app?access-token=${encodeURIComponent(
      token
    )}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  terminate(unit: DashboardWorkflowComputingUnit): void {
    this.modal.confirm({
      nzTitle: `Terminate "${unit.computingUnit.name}"?`,
      nzContent: "The pod will be deleted and the session will become unusable. This cannot be undone.",
      nzOkText: "Terminate",
      nzOkDanger: true,
      nzOnOk: () =>
        new Promise<void>((resolve, reject) => {
          this.cuService
            .terminateComputingUnit(unit.computingUnit.cuid)
            .pipe(untilDestroyed(this))
            .subscribe({
              next: () => {
                this.message.success("Session terminated");
                this.refresh();
                resolve();
              },
              error: (e: unknown) => {
                this.message.error(`Terminate failed: ${(e as Error)?.message ?? e}`);
                reject(e);
              },
            });
        }),
    });
  }

  statusColor(status: string): string {
    switch (status) {
      case "Running":
        return "green";
      case "Pending":
        return "orange";
      default:
        return "default";
    }
  }
}
