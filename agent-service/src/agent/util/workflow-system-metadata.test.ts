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

import { describe, expect, test } from "bun:test";
import { WorkflowSystemMetadata } from "./workflow-system-metadata";

function makeOp(operatorType: string) {
  return {
    operatorType,
    operatorVersion: "1",
    jsonSchema: { properties: {}, required: [], definitions: {} },
    additionalMetadata: {
      userFriendlyName: operatorType,
      operatorGroupName: "g",
      operatorDescription: operatorType,
      inputPorts: [],
      outputPorts: [{}],
    },
  };
}

describe("WorkflowSystemMetadata operator exclusion", () => {
  test("hides obsolete operator types from the agent but keeps supported ones", () => {
    const store = new WorkflowSystemMetadata();
    store.loadFromMetadata({
      operators: [
        makeOp("CSVFileScan"),
        makeOp("PythonUDFV2"),
        makeOp("RUDF"),
        makeOp("Dummy"),
        makeOp("PythonLambdaFunction"),
        makeOp("PythonUDFSourceV2"),
        makeOp("RUDFSource"),
        makeOp("CSVOldFileScan"),
        makeOp("SklearnTesting"),
      ],
      groups: [],
    } as any);

    const types = Object.keys(store.getAllOperatorTypes());
    expect(types).toContain("CSVFileScan");
    expect(types).toContain("PythonUDFV2");
    expect(types).toContain("RUDF");

    for (const hidden of [
      "Dummy",
      "PythonLambdaFunction",
      "PythonUDFSourceV2",
      "RUDFSource",
      "CSVOldFileScan",
      "SklearnTesting",
    ]) {
      expect(types).not.toContain(hidden);
      expect(store.operatorTypeExists(hidden)).toBe(false);
      expect(store.getCompactSchema(hidden)).toBeNull();
    }

    expect(store.operatorTypeExists("PythonUDFV2")).toBe(true);
    expect(store.getOperatorCount()).toBe(3);
  });
});
