// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

package org.apache.texera.service.resource

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.scala.DefaultScalaModule
import com.typesafe.scalalogging.LazyLogging
import jakarta.ws.rs.client.{Client, ClientBuilder, Entity}
import jakarta.ws.rs.core._
import jakarta.ws.rs.{Consumes, DELETE, GET, POST, PUT, Path, PathParam, Produces}
import org.apache.texera.auth.JwtParser.parseToken
import org.apache.texera.auth.SessionUser
import org.apache.texera.auth.util.{ComputingUnitAccess, HeaderField}
import org.apache.texera.config.{GuiConfig, KubernetesConfig, LLMConfig}
import org.apache.texera.dao.SqlServer
import org.apache.texera.dao.jooq.generated.enums.{PrivilegeEnum, WorkflowComputingUnitTypeEnum}
import org.apache.texera.dao.jooq.generated.tables.daos.WorkflowComputingUnitDao

import java.net.URLDecoder
import java.net.URI
import java.net.http.{HttpClient => JdkHttpClient, HttpRequest => JdkHttpRequest, HttpResponse => JdkHttpResponse}
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.time.Duration
import java.util.{Base64, Optional}
import scala.jdk.CollectionConverters.{CollectionHasAsScala, MapHasAsScala}
import scala.util.matching.Regex

object AccessControlResource extends LazyLogging {

  private val mapper: ObjectMapper = new ObjectMapper().registerModule(DefaultScalaModule)

  // Regex for the paths that require authorization
  private val wsapiWorkflowWebsocket: Regex = """.*/wsapi/workflow-websocket.*""".r
  private val apiExecutionsStats: Regex = """.*/api/executions/[0-9]+/stats/[0-9]+.*""".r
  private val apiExecutionsResultExport: Regex = """.*/api/executions/result/export.*""".r

  /**
    * Authorize the request based on the path and headers.
    * @param uriInfo URI sent by Envoy or API Gateway
    * @param headers HTTP headers sent by Envoy or API Gateway which include
    *                headers sent by the client (browser)
    * @return HTTP Response with appropriate status code and headers
    */
  def authorize(
      uriInfo: UriInfo,
      headers: HttpHeaders,
      bodyOpt: Option[String] = None
  ): Response = {
    val path = uriInfo.getPath
    logger.info(s"Authorizing request for path: $path")

    path match {
      case wsapiWorkflowWebsocket() | apiExecutionsStats() | apiExecutionsResultExport() =>
        checkComputingUnitAccess(uriInfo, headers, bodyOpt)
      case _ =>
        logger.warn(s"No authorization logic for path: $path. Denying access.")
        Response.status(Response.Status.FORBIDDEN).build()
    }
  }

  private def checkComputingUnitAccess(
      uriInfo: UriInfo,
      headers: HttpHeaders,
      bodyOpt: Option[String]
  ): Response = {
    val queryParams: Map[String, String] = uriInfo
      .getQueryParameters()
      .asScala
      .view
      .mapValues(values => values.asScala.headOption.getOrElse(""))
      .toMap

    logger.info(
      s"Request URI: ${uriInfo.getRequestUri} and headers: ${headers.getRequestHeaders.asScala} and queryParams: $queryParams"
    )

    val token: String = {
      val qToken = queryParams.get("access-token").filter(_.nonEmpty)
      val hToken = Option(headers.getRequestHeader("Authorization"))
        .flatMap(_.asScala.headOption)
        .map(_.replaceFirst("(?i)^Bearer\\s+", "")) // case-insensitive "Bearer "
        .map(_.trim)
        .filter(_.nonEmpty)
      val bToken = bodyOpt.flatMap(extractTokenFromBody)
      qToken.orElse(hToken).orElse(bToken).getOrElse("")
    }
    logger.info(s"token extracted from request $token")
    val cuid = queryParams.getOrElse("cuid", "")
    val cuidInt =
      try {
        cuid.toInt
      } catch {
        case _: NumberFormatException =>
          return Response.status(Response.Status.FORBIDDEN).build()
      }

    var cuAccess: PrivilegeEnum = PrivilegeEnum.NONE
    var userSession: Optional[SessionUser] = Optional.empty()
    try {
      userSession = parseToken(token)
      if (userSession.isEmpty)
        return Response.status(Response.Status.FORBIDDEN).build()

      val uid = userSession.get().getUid
      cuAccess = ComputingUnitAccess.getComputingUnitAccess(cuidInt, uid)
      if (cuAccess == PrivilegeEnum.NONE)
        return Response.status(Response.Status.FORBIDDEN).build()
    } catch {
      case e: Exception =>
        logger.error(s"Failed parsing token $e")
        return Response.status(Response.Status.FORBIDDEN).build()
    }

    // Dynamic Routing Logic
    // Check if the CU has a remote URI set in the database
    val cuDao = new WorkflowComputingUnitDao(
      SqlServer.getInstance().createDSLContext().configuration()
    )
    val unit = cuDao.fetchOneByCuid(cuidInt)
    val remoteUri = Option(unit.getUri).map(_.trim).filter(_.nonEmpty)

    val targetHost = remoteUri match {
      case Some(uri) =>
        logger.info(s"Routing CU $cuidInt to remote host: $uri")
        uri
      case None =>
        val workflowComputingUnitPoolName = KubernetesConfig.computeUnitPoolName
        val workflowComputingUnitPoolNamespace = KubernetesConfig.computeUnitPoolNamespace
        val workflowComputingUnitPoolPort = KubernetesConfig.computeUnitPortNumber
        s"computing-unit-$cuidInt.$workflowComputingUnitPoolName-svc.$workflowComputingUnitPoolNamespace.svc.cluster.local:$workflowComputingUnitPoolPort"
    }

    Response
      .ok()
      .header(HeaderField.UserComputingUnitAccess, cuAccess.toString)
      .header(HeaderField.UserId, userSession.get().getUid.toString)
      .header(HeaderField.UserName, userSession.get().getName)
      .header(HeaderField.UserEmail, userSession.get().getEmail)
      .header("Host", targetHost) // Envoy ExtAuth: Rewrite Host
      .build()
  }

  // Extracts a top-level "token" field from a JSON body
  private def extractTokenFromBody(body: String): Option[String] = {
    // 1) Try JSON
    val jsonToken: Option[String] =
      try {
        val node = mapper.readTree(body)
        if (node != null && node.has("token"))
          Option(node.get("token").asText()).map(_.trim).filter(_.nonEmpty)
        else None
      } catch {
        case _: Exception => None
      }

    // 2) Try application/x-www-form-urlencoded
    def extractTokenFromUrlEncoded(s: String): Option[String] = {
      // fast path: must contain '=' or '&'
      if (!s.contains("=")) return None
      val pairs = s.split("&").iterator
      var found: Option[String] = None
      while (pairs.hasNext && found.isEmpty) {
        val p = pairs.next()
        val idx = p.indexOf('=')
        val key = if (idx >= 0) p.substring(0, idx) else p
        if (key == "token") {
          val raw = if (idx >= 0) p.substring(idx + 1) else ""
          val decoded = URLDecoder.decode(raw, StandardCharsets.UTF_8.name())
          val v = decoded.trim
          if (v.nonEmpty) found = Some(v)
        }
      }
      found
    }

    // 3) Try multipart/form-data (best-effort; parses raw body text)
    def extractTokenFromMultipart(s: String): Option[String] = {
      // Look for the part with name="token" and capture its content until the next boundary
      val partWithBoundary = "(?s)name\\s*=\\s*\"token\"[^\\r\\n]*\\r?\\n\\r?\\n(.*?)\\r?\\n--".r
      val partToEnd = "(?s)name\\s*=\\s*\"token\"[^\\r\\n]*\\r?\\n\\r?\\n(.*)".r

      partWithBoundary
        .findFirstMatchIn(s)
        .map(_.group(1).trim)
        .filter(_.nonEmpty)
        .orElse(partToEnd.findFirstMatchIn(s).map(_.group(1).trim).filter(_.nonEmpty))
    }

    jsonToken
      .orElse(extractTokenFromUrlEncoded(body))
      .orElse(extractTokenFromMultipart(body))
  }
}
@Produces(Array(MediaType.APPLICATION_JSON))
@Path("/auth")
class AccessControlResource extends LazyLogging {

  @GET
  @Path("/{path:.*}")
  def authorizeGet(
      @Context uriInfo: UriInfo,
      @Context headers: HttpHeaders
  ): Response = {
    AccessControlResource.authorize(uriInfo, headers)
  }

  @POST
  @Path("/{path:.*}")
  def authorizePost(
      @Context uriInfo: UriInfo,
      @Context headers: HttpHeaders,
      body: String
  ): Response = {
    logger.info("Request body: " + body)
    AccessControlResource.authorize(uriInfo, headers, Option(body).map(_.trim).filter(_.nonEmpty))
  }
}

@Path("/chat")
@Produces(Array(MediaType.APPLICATION_JSON))
@Consumes(Array(MediaType.APPLICATION_JSON))
class LiteLLMProxyResource extends LazyLogging {

  private val client: Client = ClientBuilder.newClient()
  private val litellmBaseUrl: String = LLMConfig.baseUrl
  private val litellmApiKey: String = LLMConfig.masterKey

  @POST
  @Path("/{path:.*}")
  def proxyPost(
      @Context uriInfo: UriInfo,
      @Context headers: HttpHeaders,
      body: String
  ): Response = {
    if (!GuiConfig.guiWorkflowWorkspaceCopilotEnabled) {
      return Response
        .status(Response.Status.FORBIDDEN)
        .entity("""{"error": "Copilot feature is disabled"}""")
        .build()
    }

    // uriInfo.getPath returns "chat/completions" for /api/chat/completions
    // We want to forward as "/chat/completions" to LiteLLM
    val fullPath = uriInfo.getPath
    val targetUrl = s"$litellmBaseUrl/$fullPath"

    logger.info(s"Proxying POST request to LiteLLM: $targetUrl")

    try {
      val requestBuilder = client
        .target(targetUrl)
        .request(MediaType.APPLICATION_JSON)
        .header("Authorization", s"Bearer $litellmApiKey")

      // Forward other relevant headers from the original request
      headers.getRequestHeaders.asScala.foreach {
        case (key, values)
            if !key.equalsIgnoreCase("Authorization") &&
              !key.equalsIgnoreCase("Host") &&
              !key.equalsIgnoreCase("Content-Length") =>
          values.asScala.foreach(value => requestBuilder.header(key, value))
        case _ => // Skip Authorization, Host, and Content-Length headers
      }

      val response = requestBuilder.post(Entity.json(body))

      // Build response with same status and body from LiteLLM
      val responseBody = response.readEntity(classOf[String])
      val responseBuilder = Response
        .status(response.getStatus)
        .entity(responseBody)

      // Forward response headers
      response.getHeaders.asScala.foreach {
        case (key, values) =>
          values.asScala.foreach(value => responseBuilder.header(key, value))
      }

      responseBuilder.build()
    } catch {
      case e: Exception =>
        logger.error(s"Error proxying request to LiteLLM: ${e.getMessage}", e)
        Response
          .status(Response.Status.BAD_GATEWAY)
          .entity(s"""{"error": "Failed to proxy request to LiteLLM: ${e.getMessage}"}""")
          .build()
    }
  }
}

// Forward proxy for BioMCP session pods. Each session is a per-user pod
// running the acaciaresearch/biomcp image on port 3000; we expose it through
// the dknet-ai.org gateway as /biomcp/{cuid}/* so the user never sees the
// in-cluster DNS. Auth happens on every request: JWT via ?access-token=
// (first navigation), Authorization: Bearer ..., or a cookie set on the
// first authenticated request so sub-resource fetches (CSS/JS/etc.) keep
// working without re-passing the token.
//
// NOTE: this is a plain HTTP proxy — WebSocket upgrades will not pass
// through. If the BioMCP webapp needs WebSockets, switch this route to the
// DynamicResolver backend with ext-auth instead.
@Path("/biomcp")
class BioMcpProxyResource extends LazyLogging {

  private val httpClient: JdkHttpClient = JdkHttpClient
    .newBuilder()
    .connectTimeout(Duration.ofSeconds(10))
    .followRedirects(JdkHttpClient.Redirect.NEVER)
    .build()

  // Cookie scoped to /biomcp so a single login covers all sub-resource fetches
  // for any of the user's sessions. Ownership is still re-checked per request
  // against the cuid in the URL path.
  private val sessionCookieName = "biomcp_jwt"

  // Standard hop-by-hop headers we never forward upstream. `cookie` is
  // intentionally NOT in this set — the BioMCP app needs to see its own
  // session cookie (e.g. biomcp_auth) to recognize a logged-in user. We
  // strip only OUR own session marker from the Cookie header in
  // sanitizeCookieHeader below.
  private val hopByHop: Set[String] = Set(
    "host",
    "content-length",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "authorization"
  )

  // Remove just our own biomcp_jwt entry from a Cookie header so the upstream
  // BioMCP app sees only its own cookies. Returns None if nothing's left.
  private def sanitizeCookieHeader(value: String): Option[String] = {
    val kept = value
      .split(";")
      .map(_.trim)
      .filter(_.nonEmpty)
      .filterNot(_.startsWith(s"$sessionCookieName="))
    if (kept.isEmpty) None else Some(kept.mkString("; "))
  }

  private def extractJwt(uriInfo: UriInfo, headers: HttpHeaders): Option[String] = {
    val q = Option(uriInfo.getQueryParameters().getFirst("access-token"))
      .map(_.trim)
      .filter(_.nonEmpty)
    val h = Option(headers.getRequestHeader("Authorization"))
      .flatMap(_.asScala.headOption)
      .map(_.replaceFirst("(?i)^Bearer\\s+", "").trim)
      .filter(_.nonEmpty)
    val c = Option(headers.getCookies.get(sessionCookieName))
      .map(_.getValue.trim)
      .filter(_.nonEmpty)
    q.orElse(h).orElse(c)
  }

  // Resolve the per-pod target host:port for cuid. Uses the URI stored on the
  // CU row (which was set to the BioMCP-port DNS at create time) and falls
  // back to the canonical k8s pattern if the row's uri is blank.
  private def resolveTarget(cuid: Int): String = {
    val cuDao = new WorkflowComputingUnitDao(
      SqlServer.getInstance().createDSLContext().configuration()
    )
    val unit = cuDao.fetchOneByCuid(cuid)
    if (unit == null || unit.getType != WorkflowComputingUnitTypeEnum.biomcp) {
      throw new NoSuchElementException(s"No BioMCP session found for cuid=$cuid")
    }
    val stored = Option(unit.getUri).map(_.trim).filter(_.nonEmpty)
    stored.getOrElse {
      val poolName = KubernetesConfig.computeUnitPoolName
      val poolNs = KubernetesConfig.computeUnitPoolNamespace
      val port = KubernetesConfig.biomcpPortNumber
      s"computing-unit-$cuid.$poolName-svc.$poolNs.svc.cluster.local:$port"
    }
  }

  private def proxy(
      method: String,
      uriInfo: UriInfo,
      headers: HttpHeaders,
      cuidStr: String,
      tailPath: String,
      bodyOpt: Option[Array[Byte]]
  ): Response = {
    // 1. Auth
    val jwt = extractJwt(uriInfo, headers).getOrElse {
      return Response.status(Response.Status.UNAUTHORIZED).build()
    }
    val session: Optional[SessionUser] =
      try parseToken(jwt)
      catch {
        case e: Exception =>
          logger.warn(s"BioMCP proxy: token parse failed: ${e.getMessage}")
          return Response.status(Response.Status.UNAUTHORIZED).build()
      }
    if (session.isEmpty) return Response.status(Response.Status.UNAUTHORIZED).build()

    val cuid =
      try cuidStr.toInt
      catch { case _: NumberFormatException => return Response.status(404).build() }

    val privilege = ComputingUnitAccess.getComputingUnitAccess(cuid, session.get().getUid)
    if (privilege == PrivilegeEnum.NONE)
      return Response.status(Response.Status.FORBIDDEN).build()

    // 2. Resolve target pod
    val target =
      try resolveTarget(cuid)
      catch {
        case _: NoSuchElementException => return Response.status(404).build()
      }

    // 3. Build forward URL, preserving the query string minus our access-token
    val queryStr = uriInfo.getQueryParameters().asScala
      .view
      .filterKeys(_ != "access-token")
      .flatMap {
        case (k, vs) => vs.asScala.map(v => s"$k=$v")
      }
      .mkString("&")
    val pathSegment = if (tailPath == null || tailPath.isEmpty) "" else s"/$tailPath"
    val targetUrl =
      s"http://$target$pathSegment" + (if (queryStr.isEmpty) "" else s"?$queryStr")

    // 4. Build the JDK HttpRequest
    val builder = JdkHttpRequest
      .newBuilder()
      .uri(URI.create(targetUrl))
      .timeout(Duration.ofSeconds(60))

    headers.getRequestHeaders.asScala.foreach {
      case (name, values) =>
        val lower = name.toLowerCase
        if (hopByHop.contains(lower)) {
          // skip
        } else if (lower == "cookie") {
          values.asScala.foreach { raw =>
            sanitizeCookieHeader(raw).foreach(v => builder.header(name, v))
          }
        } else {
          values.asScala.foreach(v => builder.header(name, v))
        }
    }
    val publisher = bodyOpt
      .map(b => JdkHttpRequest.BodyPublishers.ofByteArray(b))
      .getOrElse(JdkHttpRequest.BodyPublishers.noBody())
    builder.method(method, publisher)

    // 5. Execute and stream response back
    val upstream =
      try httpClient.send(builder.build(), JdkHttpResponse.BodyHandlers.ofByteArray())
      catch {
        case t: Throwable =>
          logger.error(s"BioMCP proxy upstream call failed for cuid=$cuid: ${t.getMessage}", t)
          return Response.status(Response.Status.BAD_GATEWAY).entity(t.getMessage).build()
      }

    // 6. Rewrite upstream responses so absolute paths the app emits resolve
    //    back through this proxy. The acaciaresearch/biomcp image hard-codes
    //    routes like /app/login, /api/...; without rewriting these would
    //    escape our /biomcp/{cuid} sandbox and 404 against webserver-svc.
    val prefix = s"/biomcp/$cuid"
    val upstreamHeaders = upstream.headers().map().asScala
    val contentType = upstreamHeaders
      .find(_._1.equalsIgnoreCase("content-type"))
      .flatMap(_._2.asScala.headOption)
      .getOrElse("")

    // Per-response random nonce for our injected shim. We add `'nonce-XXX'`
    // to script-src in the CSP header (rewriteCsp) and tag our <script> with
    // it (rewriteHtmlBody). Without this the upstream `script-src 'self'`
    // policy blocks the shim from running in the browser.
    val nonce = freshNonce()
    val rewrittenBody: Array[Byte] =
      if (contentType.toLowerCase.startsWith("text/html")) {
        rewriteHtmlBody(upstream.body(), prefix, nonce)
      } else {
        upstream.body()
      }

    val rb = Response.status(upstream.statusCode()).entity(rewrittenBody)
    upstreamHeaders.foreach {
      case (name, values) =>
        val lower = name.toLowerCase
        if (hopByHop.contains(lower)) {
          // strip; JAX-RS recomputes Content-Length and we set our own cookies
        } else if (lower == "location") {
          values.asScala.foreach(v => rb.header(name, rewriteLocation(v, prefix)))
        } else if (lower == "set-cookie") {
          values.asScala.foreach(v => rb.header(name, rewriteSetCookiePath(v, prefix)))
        } else if (lower == "content-length") {
          // skip; body length changed after rewrite
        } else if (lower == "content-security-policy") {
          values.asScala.foreach(v => rb.header(name, rewriteCsp(v, nonce)))
        } else {
          values.asScala.foreach(v => rb.header(name, v))
        }
    }
    // If the caller authenticated via the query param, mint the session cookie
    // so subsequent sub-resource fetches don't need the token in the URL.
    val authedFromQuery =
      Option(uriInfo.getQueryParameters().getFirst("access-token")).exists(_.trim.nonEmpty)
    if (authedFromQuery) {
      val cookieValue =
        s"$sessionCookieName=$jwt; Path=/biomcp; Max-Age=3600; HttpOnly; SameSite=Lax; Secure"
      rb.header(HttpHeaders.SET_COOKIE, cookieValue)
    }
    rb.build()
  }

  // Prefix-roots we rewrite. Anything else stays absolute (e.g. //cdn.host
  // protocol-relative URLs, /favicon.ico — left alone so favicons don't double-
  // prefix and end up unreachable).
  private val rewriteRoots = Set("/app", "/api", "/docs", "/openapi.json", "/static")

  // Rewrite href/src/action/formaction/data-* attributes that point at one of
  // rewriteRoots so they include the /biomcp/{cuid} prefix. Also rewrites
  // bare references like fetch("/app/...") inside inline scripts — this is
  // best-effort string substitution, but covers the cases the upstream image
  // emits today (login form action, fetch calls to /api). For absolute paths
  // baked into the SPA's JS bundle (which we cannot statically rewrite), we
  // inject a runtime shim into <head> that monkey-patches fetch / XHR /
  // WebSocket to do the same prefixing at call time.
  private val rng = new SecureRandom()
  private def freshNonce(): String = {
    val buf = new Array[Byte](16)
    rng.nextBytes(buf)
    Base64.getEncoder.withoutPadding().encodeToString(buf)
  }

  // Allow our nonce-tagged shim to execute when upstream sends a strict CSP
  // (script-src 'self'). We only touch the script-src directive; everything
  // else passes through unchanged.
  private def rewriteCsp(csp: String, nonce: String): String = {
    val nonceDir = s"'nonce-$nonce'"
    val parts = csp.split(";").map(_.trim).filter(_.nonEmpty)
    val updated = parts.map { part =>
      val tokens = part.split("\\s+").toList
      tokens.headOption.map(_.toLowerCase) match {
        case Some("script-src") =>
          if (tokens.contains(nonceDir)) part else (tokens :+ nonceDir).mkString(" ")
        case _ => part
      }
    }
    updated.mkString("; ")
  }

  private def rewriteHtmlBody(body: Array[Byte], prefix: String, nonce: String): Array[Byte] = {
    val s = new String(body, StandardCharsets.UTF_8)
    val attrRe = """(?i)(href|src|action|formaction|data-url)\s*=\s*(["'])(/[^"'\s>]*)""".r
    val rewritten = attrRe.replaceAllIn(
      s,
      m => {
        val attr = m.group(1)
        val quote = m.group(2)
        val path = m.group(3)
        val newPath = if (matchesRoot(path)) prefix + path else path
        // Re-escape `$` and `\` for replaceAllIn semantics
        val escaped = (attr + "=" + quote + newPath).replace("\\", "\\\\").replace("$", "\\$")
        escaped
      }
    )
    // Also rewrite "raw" absolute path literals in inline JS / JSON like
    //   fetch("/app/chat") or "url":"/api/x"
    val literalRe = """(["'])(/(?:app|api|docs|openapi\.json|static)(?:[/?][^"'\s]*)?)\1""".r
    val pass2 = literalRe.replaceAllIn(
      rewritten,
      m => {
        val quote = m.group(1)
        val path = m.group(2)
        val newPath = quote + prefix + path + quote
        newPath.replace("\\", "\\\\").replace("$", "\\$")
      }
    )
    val withShim = injectRuntimeShim(pass2, prefix, nonce)
    withShim.getBytes(StandardCharsets.UTF_8)
  }

  // Inject a small runtime path-prefix shim immediately after <head> so it
  // executes before any of the SPA's bundled scripts. The shim wraps
  // fetch / XHR.open / WebSocket and prepends /biomcp/{cuid} to absolute
  // paths under our known roots — needed because Vite/React bundles bake
  // absolute fetch URLs into the minified JS, which the static rewriter
  // can't reliably touch.
  private def injectRuntimeShim(html: String, prefix: String, nonce: String): String = {
    val shim =
      s"""<script nonce="$nonce">(function(){var P=${js(prefix)};var R=["/app/","/api/","/docs/","/static/"];
         |function rw(u){if(typeof u!=="string")return u;if(u.indexOf(P+"/")===0)return u;
         |if(u==="/openapi.json")return P+u;
         |for(var i=0;i<R.length;i++){if(u===R[i].slice(0,-1)||u.indexOf(R[i])===0)return P+u;}return u;}
         |var of=window.fetch;if(of){window.fetch=function(input,init){
         |if(typeof input==="string")return of.call(this,rw(input),init);
         |if(typeof Request!=="undefined"&&input instanceof Request)return of.call(this,new Request(rw(input.url),input),init);
         |return of.apply(this,arguments);};}
         |var X=window.XMLHttpRequest&&XMLHttpRequest.prototype;if(X){var oo=X.open;X.open=function(m,u){arguments[1]=rw(u);return oo.apply(this,arguments);};}
         |var oWS=window.WebSocket;if(oWS){window.WebSocket=function(u,p){if(typeof u==="string"){var mm=u.match(/^(wss?:\\/\\/[^\\/]+)(\\/.*)?$$/);if(mm){u=mm[1]+rw(mm[2]||"/");}}return p?new oWS(u,p):new oWS(u);};window.WebSocket.prototype=oWS.prototype;}
         |})();</script>""".stripMargin.replace("\n", "")
    // Insert right after the opening <head ...> tag so the shim runs first.
    val headRe = """(?i)<head\b[^>]*>""".r
    headRe.findFirstMatchIn(html) match {
      case Some(m) =>
        html.substring(0, m.end) + shim + html.substring(m.end)
      case None =>
        shim + html
    }
  }

  // JSON-encode a string literal so it's safe to embed in inline JS. We only
  // pass a /biomcp/{cuid} string here, but quoting it cleanly avoids any
  // surprise if cuid ever contains odd chars.
  private def js(s: String): String = {
    val escaped = s.replace("\\", "\\\\").replace("\"", "\\\"")
    "\"" + escaped + "\""
  }

  private def matchesRoot(path: String): Boolean = {
    // Match `/app`, `/app/...`, `/api`, `/api/...`, etc. but not `/api2foo`.
    rewriteRoots.exists(root => path == root || path.startsWith(root + "/") || path.startsWith(root + "?"))
  }

  // Upstream 3xx → rewrite an absolute-path Location so the browser stays
  // inside /biomcp/{cuid}. Leaves full-URL Locations alone.
  private def rewriteLocation(loc: String, prefix: String): String = {
    if (loc.startsWith("/") && !loc.startsWith("//")) prefix + loc else loc
  }

  // Force every upstream Set-Cookie to be scoped to /biomcp/{cuid} so two
  // sessions for the same user don't clobber each other's auth state at the
  // browser. Replaces any existing Path=... attribute; appends Path if absent.
  private def rewriteSetCookiePath(c: String, prefix: String): String = {
    val stripped = c.replaceAll("(?i);\\s*Path\\s*=\\s*[^;]*", "")
    stripped + s"; Path=$prefix"
  }

  @GET
  @Path("/{cuid}/{path:.*}")
  def get(
      @Context uriInfo: UriInfo,
      @Context headers: HttpHeaders,
      @PathParam("cuid") cuid: String,
      @PathParam("path") tail: String
  ): Response = proxy("GET", uriInfo, headers, cuid, tail, None)

  @POST
  @Path("/{cuid}/{path:.*}")
  def post(
      @Context uriInfo: UriInfo,
      @Context headers: HttpHeaders,
      @PathParam("cuid") cuid: String,
      @PathParam("path") tail: String,
      body: Array[Byte]
  ): Response = proxy("POST", uriInfo, headers, cuid, tail, Option(body))

  @PUT
  @Path("/{cuid}/{path:.*}")
  def put(
      @Context uriInfo: UriInfo,
      @Context headers: HttpHeaders,
      @PathParam("cuid") cuid: String,
      @PathParam("path") tail: String,
      body: Array[Byte]
  ): Response = proxy("PUT", uriInfo, headers, cuid, tail, Option(body))

  @DELETE
  @Path("/{cuid}/{path:.*}")
  def delete(
      @Context uriInfo: UriInfo,
      @Context headers: HttpHeaders,
      @PathParam("cuid") cuid: String,
      @PathParam("path") tail: String
  ): Response = proxy("DELETE", uriInfo, headers, cuid, tail, None)
}

@Path("/models")
@Produces(Array(MediaType.APPLICATION_JSON))
class LiteLLMModelsResource extends LazyLogging {

  private val client: Client = ClientBuilder.newClient()
  private val litellmBaseUrl: String = LLMConfig.baseUrl
  private val litellmApiKey: String = LLMConfig.masterKey

  @GET
  def getModels: Response = {
    if (!GuiConfig.guiWorkflowWorkspaceCopilotEnabled) {
      return Response
        .status(Response.Status.FORBIDDEN)
        .entity("""{"error": "Copilot feature is disabled"}""")
        .build()
    }

    val targetUrl = s"$litellmBaseUrl/models"

    logger.info(s"Fetching models from LiteLLM: $targetUrl")

    try {
      val response = client
        .target(targetUrl)
        .request(MediaType.APPLICATION_JSON)
        .header("Authorization", s"Bearer $litellmApiKey")
        .get()

      // Build response with same status and body from LiteLLM
      val responseBody = response.readEntity(classOf[String])
      val responseBuilder = Response
        .status(response.getStatus)
        .entity(responseBody)

      // Forward response headers
      response.getHeaders.asScala.foreach {
        case (key, values) =>
          values.asScala.foreach(value => responseBuilder.header(key, value))
      }

      responseBuilder.build()
    } catch {
      case e: Exception =>
        logger.error(s"Error fetching models from LiteLLM: ${e.getMessage}", e)
        Response
          .status(Response.Status.BAD_GATEWAY)
          .entity(s"""{"error": "Failed to fetch models from LiteLLM: ${e.getMessage}"}""")
          .build()
    }
  }
}
