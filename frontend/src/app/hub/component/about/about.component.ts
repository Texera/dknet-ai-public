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

import { Component, ElementRef, HostBinding, HostListener, OnInit, ViewChild } from "@angular/core";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { Router } from "@angular/router";
import { UserService } from "src/app/common/service/user/user.service";
import { BehaviorSubject } from "rxjs";
import { GuiConfigService } from "../../../common/service/gui-config.service";
import { DASHBOARD_USER_WORKFLOW } from "../../../app-routing.constant";
import { NzRowDirective, NzColDirective } from "ng-zorro-antd/grid";
import { NgIf, NgFor, AsyncPipe } from "@angular/common";
import { LocalLoginComponent } from "./local-login/local-login.component";
import { GoogleSigninButtonModule } from "@abacritt/angularx-social-login";
import { UserIconComponent } from "../../../dashboard/component/user/user-icon/user-icon.component";

interface Mote {
  x: number;       // % from left
  y: number;       // % from top (start position)
  dx: number;      // px horizontal drift over the lifetime
  dur: number;     // s
  delay: number;   // s
}

@UntilDestroy()
@Component({
  selector: "texera-about",
  templateUrl: "./about.component.html",
  styleUrls: ["./about.component.scss"],
  imports: [
    NzRowDirective,
    NzColDirective,
    NgIf,
    NgFor,
    LocalLoginComponent,
    AsyncPipe,
    GoogleSigninButtonModule,
    UserIconComponent,
  ],
})
export class AboutComponent implements OnInit {
  @ViewChild("loginSection") loginSectionRef?: ElementRef<HTMLElement>;

  isLogin$ = new BehaviorSubject<boolean>(false); // control the visibility of the local login component

  // Pre-generated drifting motes. Random initial positions + drift give the
  // hero a "floating dust caught in the network" texture without needing
  // canvas. Generated once on init so each refresh has fresh placement
  // but no jitter during scroll/resize.
  readonly motes: Mote[] = Array.from({ length: 28 }, () => ({
    x: Math.random() * 100,
    y: 75 + Math.random() * 35,           // start near/below the fold
    dx: (Math.random() - 0.5) * 120,      // ±60px horizontal drift
    dur: 14 + Math.random() * 14,         // 14–28s slow rise
    delay: -Math.random() * 20,           // negative → already mid-flight on load
  }));

  // rAF-throttled parallax. We update CSS variables on the host so the bg
  // and the animation layer can shift in opposite directions for depth.
  private parallaxFrame = 0;

  // .booted on the host element ends the boot splash and reveals the hero.
  @HostBinding("class.booted") booted = false;

  // The splash holds for at least this long even if the bg image is cached,
  // so the loading animation has a chance to land instead of flashing.
  private readonly MIN_SPLASH_MS = 1800;

  constructor(
    private userService: UserService,
    private router: Router,
    private elRef: ElementRef<HTMLElement>,
    protected config: GuiConfigService
  ) {}

  ngOnInit() {
    this.isLogin$.next(this.userService.isLogin());
    // Subscribe to user changes
    this.userService
      .userChanged()
      .pipe(untilDestroyed(this))
      .subscribe(user => {
        this.isLogin$.next(user !== undefined);
      });

    this.preloadHeroBackground();
  }

  // Preload the hero background and end the splash once both the image is
  // in the browser cache and MIN_SPLASH_MS has elapsed. The splash itself
  // is pure CSS so it paints immediately; this just controls when we
  // hand off to the live hero.
  private preloadHeroBackground() {
    const start = Date.now();
    const finish = () => {
      const wait = Math.max(0, this.MIN_SPLASH_MS - (Date.now() - start));
      window.setTimeout(() => (this.booted = true), wait);
    };
    const img = new Image();
    img.onload = finish;
    img.onerror = finish; // never get stuck on the splash if bg fails
    img.src = "/assets/landing/background.webp";
  }

  @HostListener("mousemove", ["$event"])
  onMouseMove(e: MouseEvent) {
    if (this.parallaxFrame) return;
    this.parallaxFrame = requestAnimationFrame(() => {
      this.parallaxFrame = 0;
      const rect = this.elRef.nativeElement.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width - 0.5;   // -0.5..+0.5
      const ny = (e.clientY - rect.top) / rect.height - 0.5;
      const max = 22; // px of bg shift
      this.elRef.nativeElement.style.setProperty("--parallax-x", `${nx * max}px`);
      this.elRef.nativeElement.style.setProperty("--parallax-y", `${ny * max}px`);
    });
  }

  getStarted(): void {
    if (this.userService.isLogin()) {
      this.router.navigate([DASHBOARD_USER_WORKFLOW]);
      return;
    }
    const loginEl = this.loginSectionRef?.nativeElement;
    if (loginEl) {
      loginEl.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    this.router.navigate([DASHBOARD_USER_WORKFLOW]);
  }
}
