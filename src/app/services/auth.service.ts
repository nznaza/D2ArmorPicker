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

import { Injectable } from "@angular/core";
import { NGXLogger } from "ngx-logger";
import { environment } from "../../environments/environment";
import { Router } from "@angular/router";
import { Observable, ReplaySubject } from "rxjs";

@Injectable({
  providedIn: "root",
})
export class AuthService {
  private _logoutEvent: ReplaySubject<null>;
  public readonly logoutEvent: Observable<null>;

  constructor(
    private router: Router,
    private logger: NGXLogger
  ) {
    this._logoutEvent = new ReplaySubject(1);
    this.logoutEvent = this._logoutEvent.asObservable();
  }

  async getCurrentMembershipData(): Promise<any> {
    const item = JSON.parse(localStorage.getItem("auth-membershipInfo") || "null");
    if (item == null) {
      const currentMembershipData = this.getCurrentMembershipData();
      localStorage.setItem("auth-membershipInfo", JSON.stringify(currentMembershipData));
      return currentMembershipData;
    } else return item;
  }

  clearManifestInfo() {
    localStorage.removeItem("LastArmorUpdate");
    localStorage.removeItem("LastManifestUpdate");
  }

  async logout() {
    if (environment.offlineMode) {
      this.logger.debug("AuthService", "logout", "Offline mode, skipping logout");
      return;
    }
    try {
      this._logoutEvent.next(null);
      this.clearManifestInfo();
    } finally {
      await this.router.navigate(["login"]);
    }
  }
}
