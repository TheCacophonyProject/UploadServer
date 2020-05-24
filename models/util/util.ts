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

import AWS from "aws-sdk";
import log from "../../logging";
import fs from "fs";
import mime from "mime";
import config from "../../config";
import Sequelize from "sequelize";
import { User } from "../User";
import { ModelStaticCommon } from "../index";
import { ClientError } from "../../api/customErrors";

const Op = Sequelize.Op;
interface QueryResult<T> {
  rows: null | T[];
  limit: number;
  offset: number;
}

export function findAllWithUser<T extends ModelStaticCommon<T>>(
  model: T,
  user,
  queryParams
): Promise<QueryResult<T>> {
  return new Promise(function (resolve) {
    const models = require("../");
    if (typeof queryParams.limit == "undefined") {
      queryParams.limit = 20;
    }
    if (typeof queryParams.offset == "undefined") {
      queryParams.offset = 0;
    }
    queryParams.order = [["recordingDateTime", "DESC"]];
    // Find what devices the user can see.
    if (!user) {
      // Not logged in, can onnly see public recordings.
      model
        .findAndCountAll({
          where: { [Op.and]: [queryParams.where, { public: true }] },
          include: [models.Group],
          limit: queryParams.limit,
          offset: queryParams.offset
        })
        .then(function (result: QueryResult<T>) {
          result.limit = queryParams.limit;
          result.offset = queryParams.offset;
          resolve(result);
        });
    } else {
      user
        .getGroupsIds()
        .then(function (ids) {
          // Adding filter so they only see recordings that they are allowed to.
          queryParams.where = {
            [Op.and]: [
              queryParams.where,
              { [Op.or]: [{ public: true }, { GroupId: { [Op.in]: ids } }] }
            ]
          };
          queryParams.include = [
            { model: models.Group },
            { model: models.Tag }
          ];
          return model.findAndCountAll(queryParams);
        })
        .then(function (result: QueryResult<T>) {
          result.limit = queryParams.limit;
          result.offset = queryParams.offset;
          resolve(result);
        });
    }
  });
}

//NOTE: Currently unused by anyone
export function getFileData<T extends ModelStaticCommon<T>>(
  model: T,
  id: number,
  user: User
) {
  return new Promise(function (resolve, reject) {
    findAllWithUser(model, user, { where: { id } })
      .then(function (result: { rows: null | T[] }) {
        if (result.rows !== null && result.rows.length >= 1) {
          const model = result.rows[0];
          const fileData = {
            key: model.getDataValue("fileKey"),
            name: getFileName(model),
            mimeType: model.getDataValue("mimeType")
          };
          return resolve(fileData);
        } else {
          return resolve(null);
        }
      })
      .catch(function (err) {
        log.error("Error at models/util.js getFileKey:");
        reject(err);
      });
  });
}

export function getFileName(model) {
  let fileName;
  const dateStr = model.getDataValue("recordingDateTime");
  if (dateStr) {
    fileName = new Date(dateStr)
      .toISOString()
      .replace(/\..+/, "")
      .replace(/:/g, "");
  } else {
    fileName = "file";
  }

  const ext = mime.getExtension(model.getDataValue("mimeType") || "");
  if (ext) {
    fileName = fileName + "." + ext;
  }
  return fileName;
}

export function geometrySetter(val) {
  // Put here so old apps that send location in a string still work.
  // TODO remove this when nobody is using the old app that sends a string.
  if (typeof val === "string") {
    return;
  }
  this.setDataValue("location", { type: "Point", coordinates: val });
}

export function migrationAddBelongsTo(
  queryInterface,
  childTable,
  parentTable,
  opts
) {
  if (!opts) {
    opts = {};
  }
  if (opts === "strict") {
    opts = {
      notNull: true,
      cascade: true
    };
  }

  let columnName = `${parentTable.substring(0, parentTable.length - 1)}Id`;
  if (opts.name) {
    columnName = `${opts.name}Id`;
  }
  const constraintName = `${childTable}_${columnName}_fkey`;

  let deleteBehaviour = "SET NULL";
  if (opts.cascade) {
    deleteBehaviour = "CASCADE";
  }

  let columnNull = "";
  if (opts.notNull) {
    columnNull = "NOT NULL";
  }

  return new Promise(function (resolve, reject) {
    queryInterface.sequelize
      .query(
        `ALTER TABLE "${childTable}" ADD COLUMN "${columnName}" INTEGER ${columnNull};`
      )
      .then(() => {
        return queryInterface.sequelize.query(
          `ALTER TABLE "${childTable}" ADD CONSTRAINT "${constraintName}" FOREIGN KEY ("${columnName}") REFERENCES "${parentTable}" (id) ON DELETE ${deleteBehaviour} ON UPDATE CASCADE;`
        );
      })
      .then(() => resolve())
      .catch((err) => {
        console.log(err);
        reject(err);
      });
  });
}

export function renameTableAndIdSeq(queryInterface, oldName, newName) {
  return Promise.all([
    queryInterface.sequelize.query(
      `ALTER TABLE "${oldName}" RENAME TO "${newName}";`
    ),
    queryInterface.sequelize.query(
      `ALTER TABLE "${oldName}_id_seq" RENAME TO "${newName}_id_seq";`
    )
  ]);
}

export function migrationRemoveBelongsTo(
  queryInterface,
  childTable,
  parentTable,
  opts: { name?: string } = {}
) {
  let columnName = `${parentTable.substring(0, parentTable.length - 1)}Id`;
  if (opts.name) {
    columnName = `${opts.name}Id`;
  }
  return queryInterface.sequelize.query(
    `ALTER TABLE "${childTable}" DROP COLUMN "${columnName}";`
  );
}

export function belongsToMany(queryInterface, viaTable, table1, table2) {
  const columnName1 = `${table1.substring(0, table1.length - 1)}Id`;
  const constraintName1 = `${viaTable}_${columnName1}_fkey`;
  const columnName2 = `${table2.substring(0, table2.length - 1)}Id`;
  const constraintName2 = `${viaTable}_${columnName2}_fkey`;
  console.log("Adding belongs to many columns.");
  return new Promise(function (resolve, reject) {
    Promise.all([
      queryInterface.sequelize.query(
        `ALTER TABLE "${viaTable}" ADD COLUMN "${columnName1}" INTEGER;`
      ),
      queryInterface.sequelize.query(
        `ALTER TABLE "${viaTable}" ADD COLUMN "${columnName2}" INTEGER;`
      )
    ])
      .then(() => {
        console.log("Adding belongs to many constraint.");
        return Promise.all([
          queryInterface.sequelize.query(
            `ALTER TABLE "${viaTable}" ADD CONSTRAINT "${constraintName1}" FOREIGN KEY ("${columnName1}") REFERENCES "${table1}" (id) ON DELETE CASCADE ON UPDATE CASCADE;`
          ),
          queryInterface.sequelize.query(
            `ALTER TABLE "${viaTable}" ADD CONSTRAINT "${constraintName2}" FOREIGN KEY ("${columnName2}") REFERENCES "${table2}" (id) ON DELETE CASCADE ON UPDATE CASCADE;`
          )
        ]);
      })
      .then(() => resolve())
      .catch((err) => reject(err));
  });
}

export function addSerial(queryInterface, tableName) {
  return queryInterface.sequelize.query(
    `ALTER TABLE "${tableName}" ADD COLUMN id SERIAL PRIMARY KEY;`
  );
}

export function getFromId(id: number, user: User, attributes) {
  const modelClass = this;
  return new Promise((resolve) => {
    // Get just public models if no user was given
    if (!user) {
      return modelClass
        .findOne({ where: { id: id, public: true } })
        .then(resolve);
    }

    user
      .getGroupsIds()
      .then((ids) => {
        // Condition where you get a public recordin or a recording that you
        // have permission to view (in same group).
        const condition = {
          where: {
            id: id,
            [Op.or]: [{ GroupId: { [Op.in]: ids } }, { public: true }]
          },
          attributes
        };
        return modelClass.findOne(condition);
      })
      .then(resolve);
  });
}

/**
 * Deletes the deleteModelInstance and the file attached to the model with the
 * given id.
 * A promise is returned that will resolve if successful and reject if failed
 * to delete the file and modelInstance.
 */
export function deleteModelInstance(id, user) {
  const modelClass = this;
  let modelInstance = null;
  return new Promise((resolve, reject) => {
    modelClass
      .getFromId(id, user, ["fileKey", "id"])
      .then((mi) => {
        modelInstance = mi;
        if (modelInstance === null) {
          throw new ClientError("No file found");
        }
        return modelInstance.fileKey;
      })
      .then((fileKey) => deleteFile(fileKey))
      .then(() => modelInstance.destroy())
      .then(resolve)
      .catch(reject);
  });
}

export function userCanEdit(id, user) {
  const modelClass = this;
  return new Promise((resolve) => {
    //models.User.where
    modelClass.getFromId(id, user, ["id"]).then((result) => {
      if (result === null) {
        return resolve(false);
      } else {
        return resolve(true);
      }
    });
  });
}

export function openS3() {
  return new AWS.S3({
    endpoint: config.s3.endpoint,
    accessKeyId: config.s3.publicKey,
    secretAccessKey: config.s3.privateKey,
    s3ForcePathStyle: true // needed for minio
  });
}

export function saveFile(file /* model.File */) {
  const model = this;
  return new Promise(function (resolve, reject) {
    // Gets date object set to recordingDateTime field or now if field not set.
    const date = new Date(
      model.getDataValue("recordingDateTime") || new Date()
    );

    // Generate key for file using the date.
    const key = `${date.getFullYear()}/${date.getMonth()}/${date
      .toISOString()
      .replace(/\..+/, "")
      .replace(/:/g, "")}_${Math.random().toString(36).substr(2)}`;

    // Save file with key.
    const s3 = openS3();
    fs.readFile(file.path, function (err, data) {
      const params = {
        Bucket: config.s3.bucket,
        Key: key,
        Body: data
      };
      s3.upload(params, function (err) {
        if (err) {
          log.error("Error with saving to S3.");
          log.error(err);
          return reject(err);
        } else {
          fs.unlinkSync(file.path); // Delete local file.
          log.info("Successful saving to S3.");
          file.key = key;

          model.setDataValue("filename", file.name);
          model.setDataValue("mimeType", file.mimeType);
          model.setDataValue("size", file.size);
          model.setDataValue("fileKey", file.key);
          return resolve(model.save());
        }
      });
    });
  });
}

export function deleteFile(fileKey) {
  return new Promise((resolve, reject) => {
    const s3 = openS3();
    const params = {
      Bucket: config.s3.bucket,
      Key: fileKey
    };
    s3.deleteObject(params, function (err, data) {
      if (err) {
        return reject(err);
      } else {
        return resolve(data);
      }
    });
  });
}

export default {
  geometrySetter,
  findAllWithUser,
  getFileData,
  migrationAddBelongsTo,
  migrationRemoveBelongsTo,
  belongsToMany,
  addSerial,
  getFromId,
  deleteModelInstance,
  userCanEdit,
  openS3,
  saveFile,
  renameTableAndIdSeq
};
