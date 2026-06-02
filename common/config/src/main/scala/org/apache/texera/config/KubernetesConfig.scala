/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.apache.texera.config

import com.typesafe.config.{Config, ConfigFactory}

object KubernetesConfig {

  private val conf: Config = ConfigFactory.parseResources("kubernetes.conf").resolve()

  val kubernetesComputingUnitEnabled: Boolean = conf.getBoolean("kubernetes.enabled")

  // Access the Kubernetes settings with environment variable fallback
  val computeUnitServiceName: String = conf.getString("kubernetes.compute-unit-service-name")
  val computeUnitPoolName: String = conf.getString("kubernetes.compute-unit-pool-name")
  val computeUnitPoolNamespace: String = conf.getString("kubernetes.compute-unit-pool-namespace")
  val computeUnitImageName: String = conf.getString("kubernetes.image-name")
  val computingUnitImagePullPolicy: String = conf.getString("kubernetes.image-pull-policy")

  val computeUnitPortNumber: Int = conf.getInt("kubernetes.port-num")

  val maxNumOfRunningComputingUnitsPerUser: Int =
    conf.getInt("kubernetes.max-num-of-running-computing-units-per-user")

  val warmPoolCapacity: Int = conf.getInt("kubernetes.warm-pool-capacity")

  val cpuLimitOptions: List[String] =
    conf
      .getString("kubernetes.computing-unit-cpu-limit-options")
      .split(",")
      .map(_.trim)
      .filter(_.nonEmpty)
      .toList

  val memoryLimitOptions: List[String] =
    conf
      .getString("kubernetes.computing-unit-memory-limit-options")
      .split(",")
      .map(_.trim)
      .filter(_.nonEmpty)
      .toList

  val gpuLimitOptions: List[String] =
    conf
      .getString("kubernetes.computing-unit-gpu-limit-options")
      .split(",")
      .map(_.trim)
      .filter(_.nonEmpty)
      .toList

  // GPU resource key used directly in Kubernetes resource specifications
  val gpuResourceKey: String = conf.getString("kubernetes.computing-unit-gpu-resource-key")

  // BioMCP session pod settings. CPU/memory are fixed (not user-selectable)
  // because the BioMCP webapp has a known footprint; the port differs from a
  // regular CU because BioMCP serves the chat UI on /app.
  val biomcpImageName: String = conf.getString("kubernetes.biomcp-image-name")
  val biomcpPortNumber: Int = conf.getInt("kubernetes.biomcp-port-num")
  val biomcpCpuLimit: String = conf.getString("kubernetes.biomcp-cpu-limit")
  val biomcpMemoryLimit: String = conf.getString("kubernetes.biomcp-memory-limit")

  // Baked-in OpenAI settings injected into BioMCP pods. The API key is a
  // secret supplied via KUBERNETES_BIOMCP_OPENAI_API_KEY; the rest disable the
  // webapp's own auth and user-provided-key prompt so users supply nothing.
  val biomcpOpenaiApiKey: String = conf.getString("kubernetes.biomcp-openai-api-key")
  val biomcpOpenaiModel: String = conf.getString("kubernetes.biomcp-openai-model")
  val biomcpAppAuthEnabled: String = conf.getString("kubernetes.biomcp-app-auth-enabled")
  val biomcpUserProvidedKeysEnabled: String =
    conf.getString("kubernetes.biomcp-user-provided-keys-enabled")
}
