/*
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

package org.apache.texera.service.util

import software.amazon.awssdk.auth.credentials.{AwsBasicCredentials, StaticCredentialsProvider}
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.ec2.Ec2Client
import software.amazon.awssdk.services.ec2.model._

import scala.jdk.CollectionConverters._

/**
  * AwsEc2Client provides utilities for managing AWS EC2 instances using
  * user-provided credentials. Each operation creates a short-lived client
  * since different users will have different credentials.
  *
  * IMPORTANT: Credentials are never stored — they are used only for the
  * duration of the API call and then discarded.
  */
object AwsEc2Client {

  /**
    * Creates a short-lived EC2 client from user-provided credentials.
    */
  private def withEc2Client[T](
      accessKeyId: String,
      secretAccessKey: String,
      region: String
  )(f: Ec2Client => T): T = {
    val credentials = AwsBasicCredentials.create(accessKeyId, secretAccessKey)
    val client = Ec2Client
      .builder()
      .credentialsProvider(StaticCredentialsProvider.create(credentials))
      .region(Region.of(region))
      .build()
    try {
      f(client)
    } finally {
      client.close()
    }
  }

  /**
    * Finds the latest Amazon Linux 2023 AMI for the given region.
    */
  private def findLatestAmi(client: Ec2Client): String = {
    val request = DescribeImagesRequest
      .builder()
      .owners("amazon")
      .filters(
        Filter.builder().name("name").values("al2023-ami-2023*-x86_64").build(),
        Filter.builder().name("state").values("available").build(),
        Filter.builder().name("architecture").values("x86_64").build()
      )
      .build()

    val images = client.describeImages(request).images().asScala
    if (images.isEmpty) {
      throw new RuntimeException(
        "No Amazon Linux 2023 AMI found in this region. " +
          "Please check that the region is valid and your credentials have ec2:DescribeImages permission."
      )
    }
    // Pick the most recent image by sorting on creation date
    images.sortBy(_.creationDate()).last.imageId()
  }

  /**
    * Finds a public subnet in the user's account (one that auto-assigns public IPs).
    * Falls back to any available subnet if no public one is found.
    */
  private def findPublicSubnet(client: Ec2Client): String = {
    val request = DescribeSubnetsRequest.builder().build()
    val subnets = client.describeSubnets(request).subnets().asScala

    if (subnets.isEmpty) {
      throw new RuntimeException(
        "No subnets found in this region. " +
          "Please create a VPC with at least one subnet."
      )
    }

    // Prefer a subnet that auto-assigns public IPs
    subnets
      .find(_.mapPublicIpOnLaunch())
      .orElse(subnets.headOption)
      .map(_.subnetId())
      .get
  }

  /**
    * Launches a new EC2 instance, automatically resolving the AMI and subnet.
    * The user only needs to provide credentials, region, and instance type.
    *
    * @param accessKeyId     AWS access key ID (not stored)
    * @param secretAccessKey AWS secret access key (not stored)
    * @param region          AWS region (e.g., "us-west-2")
    * @param instanceType    EC2 instance type (e.g., "t2.micro")
    * @param userData        Optional base64-encoded user data script
    * @return the EC2 instance ID
    */
  def createInstance(
      accessKeyId: String,
      secretAccessKey: String,
      region: String,
      instanceType: String,
      userData: Option[String] = None
  ): String = {
    withEc2Client(accessKeyId, secretAccessKey, region) { client =>
      val amiId = findLatestAmi(client)
      val subnetId = findPublicSubnet(client)

      val requestBuilder = RunInstancesRequest
        .builder()
        .imageId(amiId)
        .instanceType(InstanceType.fromValue(instanceType))
        .subnetId(subnetId)
        .minCount(1)
        .maxCount(1)

      userData.foreach(ud => requestBuilder.userData(ud))

      val response = client.runInstances(requestBuilder.build())
      val instanceId = response.instances().get(0).instanceId()

      // Tag the instance for identification
      val tagRequest = CreateTagsRequest
        .builder()
        .resources(instanceId)
        .tags(
          Tag.builder().key("ManagedBy").value("texera").build(),
          Tag.builder().key("Type").value("computing-unit").build()
        )
        .build()
      client.createTags(tagRequest)

      instanceId
    }
  }

  /**
    * Terminates an EC2 instance.
    *
    * @param accessKeyId     AWS access key ID (not stored)
    * @param secretAccessKey AWS secret access key (not stored)
    * @param region          AWS region
    * @param instanceId      the EC2 instance ID to terminate
    */
  def terminateInstance(
      accessKeyId: String,
      secretAccessKey: String,
      region: String,
      instanceId: String
  ): Unit = {
    withEc2Client(accessKeyId, secretAccessKey, region) { client =>
      val request = TerminateInstancesRequest
        .builder()
        .instanceIds(instanceId)
        .build()
      client.terminateInstances(request)
    }
  }

  /**
    * Gets the current status of an EC2 instance.
    *
    * @return the instance state name (e.g., "running", "pending", "terminated", "stopped")
    */
  def getInstanceStatus(
      accessKeyId: String,
      secretAccessKey: String,
      region: String,
      instanceId: String
  ): String = {
    withEc2Client(accessKeyId, secretAccessKey, region) { client =>
      val request = DescribeInstancesRequest
        .builder()
        .instanceIds(instanceId)
        .build()
      val response = client.describeInstances(request)
      val reservations = response.reservations().asScala
      if (reservations.nonEmpty && reservations.head.instances().asScala.nonEmpty) {
        reservations.head.instances().get(0).state().nameAsString()
      } else {
        "unknown"
      }
    }

  }

  /**
    * Gets the public IP address of an EC2 instance, if available.
    *
    * @return Some(ip) if the instance has a public IP, None otherwise
    */
  def getInstancePublicIp(
      accessKeyId: String,
      secretAccessKey: String,
      region: String,
      instanceId: String
  ): Option[String] = {
    withEc2Client(accessKeyId, secretAccessKey, region) { client =>
      val request = DescribeInstancesRequest
        .builder()
        .instanceIds(instanceId)
        .build()
      val response = client.describeInstances(request)
      val reservations = response.reservations().asScala
      if (reservations.nonEmpty && reservations.head.instances().asScala.nonEmpty) {
        Option(reservations.head.instances().get(0).publicIpAddress())
      } else {
        None
      }
    }
  }
}
