/*
 * Copyright (c) 2023 D2ArmorPicker by Mijago.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import { Component, AfterViewInit } from "@angular/core";
import { NGXLogger } from "ngx-logger";
import { ActivatedRoute, Router } from "@angular/router";
import { AuthService } from "../../services/auth.service";

@Component({
  selector: "app-handle-bungie-login",
  templateUrl: "./handle-bungie-login.component.html",
  styleUrls: ["./handle-bungie-login.component.css"],
})
export class HandleBungieLoginComponent implements AfterViewInit {
  constructor(
    private activatedRoute: ActivatedRoute,
    private router: Router,
    private loginService: AuthService,
    private logger: NGXLogger
  ) {}

  ngAfterViewInit(): void {
    this.activatedRoute.queryParams.subscribe(async (params) => {
      let code = params["code"];
      if (window.location.search.indexOf("?code=") > -1) code = window.location.search.substr(6);

      if (!code) {
        this.logger.warn(
          "HandleBungieLoginComponent",
          "ngAfterViewInit",
          "No OAuth code found, redirecting to login"
        );
        await this.router.navigate(["/login"]);
        return;
      }

      this.logger.info(
        "HandleBungieLoginComponent",
        "ngAfterViewInit",
        "Code: " + JSON.stringify({ code })
      );

      this.loginService.authCode = code;

      this.logger.info(
        "HandleBungieLoginComponent",
        "ngAfterViewInit",
        "Generate tokens with the new code"
      );

      try {
        const tokenGenerationSuccess = await this.loginService.generateTokens();

        if (tokenGenerationSuccess && this.loginService.isAuthenticated()) {
          this.logger.info(
            "HandleBungieLoginComponent",
            "ngAfterViewInit",
            "Authentication successful, navigating to /"
          );
          // Clear the auth code from localStorage after successful token generation
          this.loginService.authCode = null;
          // Use Angular router navigation with replaceUrl to clean up the URL history
          await this.router.navigate(["/"], { replaceUrl: true });
        } else {
          this.logger.error(
            "HandleBungieLoginComponent",
            "ngAfterViewInit",
            "Token generation failed, navigating to login"
          );
          await this.router.navigate(["/login"]);
        }
      } catch (error) {
        this.logger.error(
          "HandleBungieLoginComponent",
          "ngAfterViewInit",
          "Error during token generation",
          error
        );
        await this.router.navigate(["/login"]);
      }
    });
  }
}
