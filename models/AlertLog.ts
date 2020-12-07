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

const { AuthorizationError } = require("../api/customErrors");

export interface AlertLog extends Sequelize.Model, ModelCommon<AlertLog> {
  id: number;
}
export interface AlertLogStatic extends ModelStaticCommon<AlertLog> {
  getFromId: (id: number) => Promise<AlertLog>;
}

export default function (sequelize, DataTypes): AlertLogStatic {
  const name = "AlertLog";

  const attributes = {
    recId: DataTypes.INTEGER,
    trackId: DataTypes.INTEGER,
    success: DataTypes.BOOLEAN,
    sentAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  };

  const AlertLog = (sequelize.define(
    name,
    attributes
  ) as unknown) as AlertLogStatic;

  AlertLog.apiSettableFields = [];

  //---------------
  // Class methods
  //---------------
  const models = sequelize.models;
  AlertLog.addAssociations = function (models) {
    models.AlertLog.belongsTo(models.Alert);
  };
  AlertLog.getFromId = async function (id) {
    return this.findByPk(id);
  };

  return AlertLog;
}