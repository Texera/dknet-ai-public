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

import scala.jdk.CollectionConverters._

object AwsEc2Config {

  private val conf: Config = ConfigFactory.parseResources("aws-ec2.conf").resolve()

  val awsEc2Enabled: Boolean = conf.getBoolean("aws-ec2.enabled")
  val defaultRegion: String = conf.getString("aws-ec2.default-region")
  val computingUnitPort: Int = conf.getInt("aws-ec2.computing-unit-port")
  val instanceTypeOptions: List[String] = {
    val raw = conf.getString("aws-ec2.instance-type-options")
    raw.split(",").map(_.trim).filter(_.nonEmpty).toList
  }
}
