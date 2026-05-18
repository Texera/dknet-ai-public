package org.apache.texera.web.resource.dashboard.user.cluster

import org.apache.texera.amber.config.ApplicationConfig

import java.net.{HttpURLConnection, URL}
import scala.io.Source
import scala.util.{Failure, Success, Try}

object ClusterServiceClient {

  private def base: String =
    ApplicationConfig.clusterLauncherServiceTarget.stripSuffix("/")

  def callCreateClusterAPI(
      clusterId: Int,
      machineType: String,
      numberOfMachines: Int
  ): Either[String, String] = {
    val url = new URL(s"$base/api/cluster/create")
    val jsonInputString =
      s"""{
         |"provider": "aws",
         |"machineType": "$machineType",
         |"numberOfNodes": $numberOfMachines,
         |"clusterId": $clusterId
         |}""".stripMargin

    sendHttpRequest("POST", url, Some(jsonInputString))
  }

  def callDeleteClusterAPI(clusterId: Int): Either[String, String] = {
    val url = new URL(s"$base/api/cluster/$clusterId")
    sendHttpRequest("DELETE", url, None)
  }

  def callPauseClusterAPI(clusterId: Int): Either[String, String] = {
    val url = new URL(s"$base/api/cluster/$clusterId")
    sendHttpRequest("PUT", url, None)
  }

  def callResumeClusterAPI(clusterId: Int): Either[String, String] = {
    val url = new URL(s"$base/api/cluster/resume/$clusterId")
    sendHttpRequest("POST", url, None)
  }

  private def sendHttpRequest(
      method: String,
      url: URL,
      jsonInputString: Option[String]
  ): Either[String, String] = {
    Try {
      val conn = url.openConnection().asInstanceOf[HttpURLConnection]
      conn.setRequestMethod(method)
      conn.setRequestProperty("Content-Type", "application/json")
      conn.setDoOutput(jsonInputString.isDefined)

      jsonInputString.foreach { input =>
        val os = conn.getOutputStream
        os.write(input.getBytes("UTF-8"))
        os.close()
      }

      val responseCode = conn.getResponseCode
      val result = if (responseCode == HttpURLConnection.HTTP_OK) {
        Right(Source.fromInputStream(conn.getInputStream).mkString)
      } else {
        Left(s"Failed: HTTP error code $responseCode")
      }

      conn.disconnect()
      result
    } match {
      case Success(result) => result
      case Failure(exception) =>
        Left(s"Error: ${exception.getMessage}")
    }
  }
}
