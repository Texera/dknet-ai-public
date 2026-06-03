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

import { AgentRegistrationComponent } from "./agent-registration.component";
import { AgentService, ModelType } from "../../../../service/agent/agent.service";
import { NotificationService } from "../../../../../common/service/notification/notification.service";

function model(id: string): ModelType {
  return { id, name: id, description: "", icon: "robot" };
}

describe("AgentRegistrationComponent", () => {
  let component: AgentRegistrationComponent;

  beforeEach(() => {
    component = new AgentRegistrationComponent({} as AgentService, {} as NotificationService);
  });

  it("uses the Claude brand icon for claude-prefixed models", () => {
    expect(component.getModelIconSrc(model("claude-opus-4"))).toBe("assets/svg/claude.png");
    expect(component.getModelIconSrc(model("anthropic/claude-3-5-sonnet"))).toBe("assets/svg/claude.png");
    expect(component.getModelIconSrc(model("Claude-3"))).toBe("assets/svg/claude.png");
  });

  it("uses the GPT brand icon for gpt-prefixed models", () => {
    expect(component.getModelIconSrc(model("gpt-4o"))).toBe("assets/svg/gpt.png");
    expect(component.getModelIconSrc(model("openai/gpt-4o-mini"))).toBe("assets/svg/gpt.png");
  });

  it("returns null (robot fallback) for other models", () => {
    expect(component.getModelIconSrc(model("gemini-1.5-pro"))).toBeNull();
    expect(component.getModelIconSrc(model("llama-3.1-70b"))).toBeNull();
    expect(component.getModelIconSrc(model(""))).toBeNull();
  });
});
