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

import { AfterViewInit, Component, OnInit } from "@angular/core";
import { environment } from "../environments/environment";
import { UserInformationService } from "src/app/services/user-information.service";
import { NGXLogger } from "ngx-logger";
import { AuthService } from "./services/auth.service";

@Component({
  selector: "app-root",
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.scss"],
})
export class AppComponent implements AfterViewInit, OnInit {
  title = "D2ArmorPicker";
  is_beta = environment.beta;
  is_canary = environment.canary;

  constructor(
    private userInformationService: UserInformationService,
    private logger: NGXLogger,
    public authService: AuthService
  ) {}

  ngOnInit() {
    this.logger.debug("AppComponent", "ngOnInit", "Application initialized");
    window.addEventListener("unhandledrejection", (event) => {
      this.logger.error("AppV2CoreComponent", "Unhandled Promise Rejection", JSON.stringify(event));
    });
    window.onerror = (errorMsg, url, lineNumber) => {
      this.logger.error(
        "AppV2CoreComponent",
        "Unhandled Error",
        JSON.stringify({ errorMsg, url, lineNumber })
      );
      return false;
    };
  }

  ngAfterViewInit(): void {
    // Check if UserInformationService is initialized after 10 seconds
    // if not, forcefully trigger an initial refreshAll
    setTimeout(() => {
      if (!this.userInformationService.isInitialized) {
        this.logger.warn(
          "AppComponent",
          "ngAfterViewInit",
          "UserInformationService is not initialized after 10 seconds, triggering initial refreshManifestAndArmor."
        );
        this.userInformationService.refreshManifestAndInventory(true, true).catch((err) => {
          this.logger.error(
            "AppComponent",
            "ngAfterViewInit",
            "Error during initial refreshManifestAndArmor:",
            err
          );
        });
      }
    }, 10 * 1000);
  }
}
