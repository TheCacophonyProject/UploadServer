/*
cacophony-api: The Cacophony Project API server
Copyright (C) 2018  The Cacophony Project

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

import Sequelize from "sequelize";
import { ModelCommon, ModelStaticCommon } from "./index";
import { User } from "./User";

const { AuthorizationError } = require("../api/customErrors");
export type AlertId = number;

export interface Alert extends Sequelize.Model, ModelCommon<Alert> {
  id: AlertId;
  addUser: (userToAdd: User, through: any) => Promise<void>;
}
export interface AlertStatic extends ModelStaticCommon<Alert> {
  getFromId: (id: AlertId) => Promise<Alert>;
  query: (where: any, user: User) => Promise<Alert[]>;
}

export default function (sequelize, DataTypes): AlertStatic {
  const name = "Alert";

  const attributes = {
    alertName: {
      type: DataTypes.STRING,
      unique: true
    }
  };

  const Alert = (sequelize.define(name, attributes) as unknown) as AlertStatic;

  Alert.apiSettableFields = [];

  //---------------
  // Class methods
  //---------------
  const models = sequelize.models;

  Alert.addAssociations = function (models) {
    models.Alert.belongsToMany(models.User, { through: models.UserAlert });
    models.Alert.belongsToMany(models.Group, { through: models.AlertGroup });
    models.Alert.belongsToMany(models.Device, { through: models.AlertDevice });
  };

  Alert.getFromId = async function (id) {
    return this.findByPk(id);
  };

  Alert.query = async function (where, user: User) {
    let userWhere = { id: user.id };
    if (user.hasGlobalRead()) {
      userWhere = null;
    }
    return await models.Alert.findAll({
      where: where,
      attributes: ["id", "alertName"],
      include: [
        {
          model: models.User,
          // NOTE(jon): This adds GroupUsers to the group, which is currently required
          // by the groups admin view to add new users to groups.  As per
          // https://github.com/TheCacophonyProject/cacophony-api/issues/279
          // we'd like to split this out into separate requests probably.
          attributes: ["id", "username"],
          where: userWhere
        }
      ]
    });
  };

  return Alert;
}