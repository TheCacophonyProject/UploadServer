/*
cacophony-api: The Cacophony Project API server
Copyright (C) 2019  The Cacophony Project

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
import { TrackTag, TrackTagId, AI_MASTER } from "./TrackTag";
import { User } from "./User";
import { Recording } from "./Recording";

export type TrackId = number;
export interface Track extends Sequelize.Model, ModelCommon<Track> {
  getTrackTag: (trackTagId: TrackTagId) => Promise<TrackTag>;
  id: TrackId;
  AlgorithmId: number | null;
  data: any;
  addTag: (
    what: string,
    confidence: number,
    automatic: boolean,
    data: any,
    userId?: number
  ) => Promise<TrackTag>;
  // NOTE: Implicitly created by sequelize associations.
  getRecording: () => Promise<Recording>;
}
export interface TrackStatic extends ModelStaticCommon<Track> {
  replaceTag: (id: TrackId, tag: TrackTag) => Promise<any>;
}

export default function (
  sequelize: Sequelize.Sequelize,
  DataTypes
): TrackStatic {
  const { ClientError } = require("../api/customErrors");

  const Track = sequelize.define("Track", {
    data: DataTypes.JSONB,
    archivedAt: DataTypes.DATE
  }) as unknown as TrackStatic;

  //---------------
  // CLASS
  //---------------
  Track.addAssociations = function (models) {
    models.Track.belongsTo(models.Recording);
    models.Track.belongsTo(models.DetailSnapshot, {
      as: "Algorithm",
      foreignKey: "AlgorithmId"
    });
    models.Track.hasMany(models.TrackTag);
  };

  const models = sequelize.models;

  Track.apiSettableFields = Object.freeze(["algorithm", "data", "archivedAt"]);

  Track.userGetAttributes = Object.freeze(
    Track.apiSettableFields.concat(["id"])
  );

  //add or replace a tag, such that this track only has 1 animal tag by this user
  //and no duplicate tags
  Track.replaceTag = async function (trackId, tag: TrackTag) {
    const track = await Track.findByPk(trackId);
    if (!track) {
      throw new ClientError("No track found for " + trackId);
    }
    return sequelize.transaction(async function (t) {
      const trackTags = await models.TrackTag.findAll({
        where: {
          UserId: tag.UserId,
          automatic: tag.automatic,
          TrackId: trackId
        },
        transaction: t
      });

      const existingTag = trackTags.find(function (uTag) {
        return uTag.what == tag.what;
      });
      if (existingTag) {
        return;
      } else if (trackTags.length > 0 && !tag.isAdditionalTag()) {
        const existingAnimalTags = trackTags.filter(function (uTag) {
          return !uTag.isAdditionalTag();
        });

        for (let i = 0; i < existingAnimalTags.length; i++) {
          await existingAnimalTags[i].destroy();
        }
      }
      await tag.save();
    });
  };

  // Adds a tag to a track and checks if any alerts need to be sent. All trackTags
  // should be added this way
  Track.prototype.addTag = async function (
    what,
    confidence,
    automatic,
    data,
    userId = null
  ) {
    const tag = await this.createTrackTag({
      what: what,
      confidence: confidence,
      automatic: automatic,
      data: data,
      UserId: userId
    });
    return tag;
  };
  // Return a specific track tag for the track.
  Track.prototype.getTrackTag = async function (trackTagId) {
    const trackTag = await models.TrackTag.findByPk(trackTagId);
    if (!trackTag) {
      return null;
    }

    // Ensure track tag belongs to this track.
    if (trackTag.TrackId !== this.id) {
      return null;
    }

    return trackTag;
  };

  return Track;
}
