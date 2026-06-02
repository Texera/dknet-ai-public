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

import { HttpClientTestingModule, HttpTestingController } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { firstValueFrom, of } from "rxjs";
import { AuthService, TOKEN_KEY } from "../../../common/service/user/auth.service";
import { NotificationService } from "../../../common/service/notification/notification.service";
import { UserService } from "../../../common/service/user/user.service";
import { MOCK_USER, StubUserService } from "../../../common/service/user/stub-user.service";
import { WorkflowPersistService } from "../../../common/service/workflow-persist/workflow-persist.service";
import { ComputingUnitStatusService } from "../../../common/service/computing-unit/computing-unit-status/computing-unit-status.service";
import { AgentService } from "./agent.service";
import { AgentState } from "./agent-types";

describe("AgentService", () => {
  let service: AgentService;
  let http: HttpTestingController;
  let userService: StubUserService;

  function putCachedAgent(id = "stale-agent"): void {
    (service as any).agents.set(id, {
      id,
      name: "Stale",
      modelType: "m",
      isBaselineMode: false,
      createdAt: new Date(),
      state: AgentState.AVAILABLE,
    });
  }

  function backendAgent(id = "backend-agent") {
    return {
      id,
      name: "Backend Agent",
      modelType: "m",
      state: "AVAILABLE",
      createdAt: new Date().toISOString(),
    };
  }

  beforeEach(() => {
    localStorage.removeItem(TOKEN_KEY);
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AgentService,
        { provide: UserService, useClass: StubUserService },
        {
          provide: NotificationService,
          useValue: {
            error: vi.fn(),
            warning: vi.fn(),
          },
        },
        {
          provide: WorkflowPersistService,
          useValue: {
            retrieveWorkflow: vi.fn(() => of(null)),
          },
        },
        {
          provide: ComputingUnitStatusService,
          useValue: {
            getSelectedComputingUnitValue: vi.fn(() => undefined),
          },
        },
      ],
    });
    service = TestBed.inject(AgentService);
    http = TestBed.inject(HttpTestingController);
    userService = TestBed.inject(UserService) as unknown as StubUserService;
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem(TOKEN_KEY);
  });

  it("returns no agents and clears local cache when no user token exists", async () => {
    putCachedAgent();

    const agents = await firstValueFrom(service.getAllAgents());

    expect(agents).toEqual([]);
    expect((service as any).agents.size).toBe(0);
  });

  it("clears stale cached agents when the protected backend list is rejected", async () => {
    AuthService.setAccessToken("valid-user-token");
    putCachedAgent();

    const pending = firstValueFrom(service.getAllAgents());
    const req = http.expectOne("/api/agents");
    expect(req.request.headers.get("Authorization")).toBe("Bearer valid-user-token");
    req.flush({ error: "Unauthorized" }, { status: 401, statusText: "Unauthorized" });

    expect(await pending).toEqual([]);
    expect((service as any).agents.size).toBe(0);
  });

  it("clears the previous user's cached agents when the logged-in user changes", () => {
    AuthService.setAccessToken("new-user-token");
    putCachedAgent();

    userService.userChangeSubject.next({ ...MOCK_USER, uid: 42 });
    const req = http.expectOne("/api/agents");
    req.flush({ agents: [] });

    expect((service as any).agents.size).toBe(0);
  });

  it("loads backend agents and notifies subscribers when a user logs in", () => {
    AuthService.setAccessToken("new-user-token");
    const changes = vi.fn();
    const subscription = service.agentChange$.subscribe(changes);

    userService.userChangeSubject.next({ ...MOCK_USER, uid: 43 });
    const req = http.expectOne("/api/agents");
    expect(req.request.headers.get("Authorization")).toBe("Bearer new-user-token");
    req.flush({ agents: [backendAgent("visible-agent")] });

    expect(Array.from((service as any).agents.keys())).toEqual(["visible-agent"]);
    expect(changes).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
  });
});
