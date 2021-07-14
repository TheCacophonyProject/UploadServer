/*
cacophony-api: The Cacophony Project API server
Copyright (C) 2020  The Cacophony Project

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
import Sequelize, { BuildOptions } from "sequelize";
import { ModelCommon, ModelStaticCommon } from "./index";
import { User, UserId } from "./User";
import { Recording } from "./Recording";
import { Track } from "./Track";
import { TrackTag } from "./TrackTag";
import { EventStatic } from "./Event";
import { alertBody, sendEmail } from "../emailUtil";
const { AuthorizationError } = require("../api/customErrors");

export type AlertId = number;
const Op = Sequelize.Op;

export interface AlertCondition {
  tag: string;
}
export function isAlertCondition(condition: any) {
  return condition.hasOwnProperty("tag");
}

export interface Alert extends Sequelize.Model, ModelCommon<Alert> {
  id: AlertId;
  UserId: UserId;
  conditions: AlertCondition[];
  frequencySeconds: number;
}

export interface AlertStatic extends ModelStaticCommon<Alert> {
  query: (
    where: any,
    user: User | null,
    deviceId: number | null,
    trackTag?: TrackTag | null,
    admin?: boolean
  ) => Promise<any[]>;
  getFromId: (id: number, user: User) => Promise<Alert>;
  getActiveAlerts: (deviceId: number, tag: TrackTag) => Promise<any[]>;
  sendAlert: (recording: Recording, track: Track) => Promise<null>;
}

export default function (sequelize, DataTypes): AlertStatic {
  const name = "Alert";

  const attributes = {
    name: {
      type: DataTypes.STRING
    },
    frequencySeconds: DataTypes.INTEGER,
    lastAlert: DataTypes.DATE,
    conditions: DataTypes.JSONB
  };

  const Alert = sequelize.define(name, attributes);

  Alert.apiSettableFields = [];

  //---------------
  // Class methods
  //---------------
  const models = sequelize.models;

  Alert.addAssociations = function (models) {
    models.Alert.belongsTo(models.User);
    models.Alert.belongsTo(models.Device);
  };

  Alert.getFromId = async function (id: number, user: User) {
    let userWhere = { id: user.id };
    if (user.hasGlobalRead()) {
      userWhere = null;
    }

    return await models.Alert.findOne({
      where: { id: id },
      attributes: ["id", "name", "frequencySeconds", "conditions", "lastAlert"],
      include: [
        {
          model: models.User,
          attributes: ["id", "username"],
          where: userWhere
        },
        {
          model: models.Device,
          attributes: ["id", "devicename"]
        }
      ]
    });
  };

  Alert.query = async function (
    where: any,
    user: User | null,
    trackTag: TrackTag | null,
    admin: boolean = false
  ) {
    let userWhere = {};
    if (!admin) {
      userWhere = { id: user.id };
      if (user.hasGlobalRead()) {
        userWhere = null;
      }
    }
    const alerts = await models.Alert.findAll({
      where: where,
      attributes: ["id", "name", "frequencySeconds", "conditions", "lastAlert"],
      include: [
        {
          model: models.User,
          attributes: ["id", "username", "email"],
          where: userWhere
        },
        {
          model: models.Device,
          attributes: ["id", "devicename"]
        }
      ]
    });
    if (trackTag) {
      return alerts.filter((alert) =>
        filterConditions(alert.conditions as AlertCondition[], trackTag)
      );
    }
    return alerts;
  };

  // check that any of the alert conditions are met
  function filterConditions(
    conditions: AlertCondition[],
    trackTag: TrackTag
  ): boolean {
    return conditions.some((condition) => condition.tag == trackTag.what);
  }

  // get all alerts for this device that satisfy the what condition and have
  // not been triggered already (are active)
  Alert.getActiveAlerts = async function (deviceId: number, tag: TrackTag) {
    return Alert.query(
      {
        DeviceId: deviceId,
        lastAlert: {
          [Op.or]: {
            [Op.eq]: null,
            [Op.lt]: Sequelize.literal(
              `now() - "frequencySeconds" * INTERVAL '1 second'`
            )
          }
        }
      },
      null,
      tag,
      true
    );
  };

  Alert.prototype.sendAlert = async function (
    recording: Recording,
    track: Track,
    tag: TrackTag
  ) {
    const subject = `${this.name}  - ${tag.what} Detected`;
    const [html, text] = alertBody(recording, tag, this.Device.devicename);
    const alertTime = new Date().toISOString();
    const result = await sendEmail(html, text, this.User.email, subject);
    const detail = await models.DetailSnapshot.getOrCreateMatching("alert", {
      alertId: this.id,
      recId: recording.id,
      trackId: track.id,
      success: result
    });
    await models.Event.create({
      DeviceId: this.Device.id,
      EventDetailId: detail.id,
      dateTime: alertTime
    });

    await this.update({ lastAlert: alertTime });
  };

  return Alert;
}
