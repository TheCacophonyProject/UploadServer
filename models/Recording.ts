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
import log from "../logging";
import mime from "mime";
import moment from "moment-timezone";
import Sequelize, { FindOptions, Includeable, Order } from "sequelize";
import assert from "assert";
import { v4 as uuidv4 } from "uuid";
import config from "../config";
import util from "./util/util";
import validation from "./util/validation";
import { AuthorizationError } from "../api/customErrors";
import _ from "lodash";
import { User } from "./User";
import { ModelCommon, ModelStaticCommon } from "./index";
import { AcceptableTag, TagStatic } from "./Tag";
import {
  Device,
  DeviceId,
  DeviceId as DeviceIdAlias,
  DeviceStatic
} from "./Device";
import { GroupId as GroupIdAlias } from "./Group";
import { Track, TrackId } from "./Track";
import jsonwebtoken from "jsonwebtoken";
import { TrackTag } from "./TrackTag";
import { Station, StationId } from "./Station";
import { tryToMatchRecordingToStation } from "../api/V1/recordingUtil";

export type RecordingId = number;
type SqlString = string;

export enum TagMode {
  Any = "any",
  UnTagged = "untagged",
  Tagged = "tagged",
  HumanTagged = "human-tagged",
  AutomaticallyTagged = "automatic-tagged",
  BothTagged = "both-tagged",
  NoHuman = "no-human", // untagged or automatic only
  AutomaticOnly = "automatic-only",
  HumanOnly = "human-only",
  AutomaticHuman = "automatic+human"
}

type AllTagModes = TagMode | AcceptableTag;
// local
const validTagModes = new Set([
  ...Object.values(TagMode),
  ...Object.values(AcceptableTag)
]);

export enum RecordingType {
  ThermalRaw = "thermalRaw",
  Audio = "audio"
}

export enum RecordingPermission {
  DELETE = "delete",
  TAG = "tag",
  VIEW = "view",
  UPDATE = "update"
}

export enum RecordingProcessingState {
  Corrupt = "CORRUPT",
  AnalyseThermal = "analyse",
  Finished = "FINISHED",
  ToMp3 = "toMp3",
  Analyse = "analyse",
  Reprocess = "reprocess"
}
export const RecordingPermissions = new Set(Object.values(RecordingPermission));

interface RecordingQueryBuilder {
  new (): RecordingQueryBuilder;
  findInclude: (modelType: ModelStaticCommon<any>) => Includeable[];
  init: (
    user: User,
    where: any,
    tagMode?: TagMode,
    tags?: string[], // AcceptableTag[]
    offset?: number,
    limit?: number,
    order?: any,
    viewAsSuperAdmin?: boolean
  ) => Promise<RecordingQueryBuilderInstance>;
  handleTagMode: (tagMode: TagMode, tagWhatsIn: string[]) => SqlString;
  recordingTaggedWith: (tagModes: string[], any) => SqlString;
  trackTaggedWith: (tags: string[], sql: SqlString) => SqlString;
  notTagOfType: (tags: string[], sql: SqlString) => SqlString;
  tagOfType: (tags: string[], sql: SqlString) => SqlString;
  selectByTagWhat: (
    tags: string[],
    whatName: string,
    useDetail: boolean
  ) => any;
}

interface RecordingQueryBuilderInstance {
  addAudioEvents: (
    before?: string,
    after?: string
  ) => RecordingQueryBuilderInstance;
  get: () => FindOptions;
  addColumn: (name: string) => RecordingQueryBuilderInstance;
  query: any;
}

export interface SpeciesClassification {
  end_s: number;
  begin_s: number;
  species: string;
}

export interface CacophonyIndex {
  end_s: number;
  begin_s: number;
  index_percent: number;
}

export interface AudioRecordingMetadata {
  ["SIM IMEI"]: string;
  ["SIM state"]: string;
  ["Phone model"]: string;
  amplification: number;
  SimOperatorName: string;
  ["Android API Level"]: number;
  ["Phone manufacturer"]: string;
  ["App has root access"]: boolean;
  analysis: {
    cacophony_index: CacophonyIndex[];
    species_identify: SpeciesClassification[];
    cacophony_index_version: string;
    processing_time_seconds: number;
    species_identify_version: string;
    speech_detection: boolean;
    speech_detection_version: string;
  };
}

export interface VideoRecordingMetadata {
  previewSecs: number;
  algorithm?: number;
  totalFrames?: number;
  oldTags?: {
    id: number;
    what: string;
    detail: string;
    version: number;
    duration: null | number;
    taggerId: null | number;
    automatic: boolean;
    createdAt: string;
    startTime: string | null;
    updatedAt: string;
    confidence: number;
    RecordingId: number;
  }[];
  tracks?: {
    start_s: number;
    end_s: number;
    label: string;
    clarity: number;
    confidence: number;
    max_novelty: number;
    average_novelty: number;
    all_class_confidences: Record<string, number>;
  };
}

export interface RecordingProcessingMetadata {
  // Only set during recording processing?
}

// TODO(jon): Express audio and video recordings differently.  Recording<Audio>, Recording<Video>
export interface Recording extends Sequelize.Model, ModelCommon<Recording> {
  // Recording columns.
  id: RecordingId;
  type: RecordingType;
  duration: number;
  recordingDateTime: string;
  location?: { coordinates: [number, number] } | [number, number]; // [number, number] is the format coordinates are set in, but they are returned as { coordinates: [number, number] }
  relativeToDawn: number;
  relativeToDusk: number;
  version: string;
  additionalMetadata: AudioRecordingMetadata | VideoRecordingMetadata;
  comment: string;
  public: boolean;
  rawFileKey: string;
  rawMimeType: string;
  rawFileHash: string;
  fileKey: string;
  fileMimeType: string;
  processingStartTime: string;
  processingMeta: RecordingProcessingMetadata;
  processingState: RecordingProcessingState;
  passedFilter: boolean;
  jobKey: string;
  batteryLevel: number;
  batteryCharging: "NOT_CHARGING" | "CHARGING" | "FULL" | "DISCHARGING";
  airplaneModeOn: boolean;

  DeviceId: DeviceIdAlias;
  GroupId: GroupIdAlias;
  StationId: StationId;
  // Recording columns end

  getFileBaseName: () => string;
  getRawFileName: () => string;
  getFileName: () => string;
  getRawFileExt: () => string;
  getFileExt: () => string;
  getActiveTracks: () => Promise<Track[]>;
  getDevice: () => Promise<Device>;

  getActiveTracksTagsAndTagger: () => Promise<any>;
  getUserPermissions: (user: User) => Promise<RecordingPermission[]>;

  reprocess: (user: User) => Promise<Recording>;
  mergeUpdate: (updates: any) => Promise<void>;
  filterData: (options: any) => void;
  // NOTE: Implicitly created by sequelize associations (along with other
  //  potentially undocumented extension methods).
  getTrack: (id: TrackId) => Promise<Track | null>;
  getTracks: (options: FindOptions) => Promise<Track[]>;
  createTrack: ({ data: any, AlgorithmId: DetailSnapshotId }) => Promise<Track>;

  setStation: (station: Station) => Promise<void>;
}
type CptvFile = "string";
type JwtToken<T> = string;
type Seconds = number;
type Rectangle = [number, number, number, number];
export interface LimitedTrack {
  TrackId: TrackId;
  data: {
    start_s: number;
    end_s: number;
    positions: [Seconds, Rectangle][];
    num_frames: number;
  };
  tags: string[];
  needsTagging: boolean;
}

interface TagLimitedRecording {
  RecordingId: RecordingId;
  DeviceId: DeviceId;
  tracks: LimitedTrack[];
  recordingJWT: JwtToken<CptvFile>;
  tagJWT: JwtToken<TrackTag>;
}

type getOptions = {
  type?: RecordingType;
  filterOptions?: { latLongPrec?: number };
};
export interface RecordingStatic extends ModelStaticCommon<Recording> {
  buildSafely: (fields: Record<string, any>) => Recording;
  isValidTagMode: (mode: TagMode) => boolean;
  processingAttributes: string[];
  processingStates: {
    [RecordingType.ThermalRaw]: string[];
    [RecordingType.Audio]: string[];
  };
  uploadedState: (type: RecordingType) => RecordingProcessingState;
  finishedState: (type: RecordingType) => RecordingProcessingState;

  getOneForProcessing: (
    type: RecordingType,
    state: RecordingProcessingState
  ) => Promise<Recording>;
  userGetAttributes: readonly string[];
  queryGetAttributes: readonly string[];
  queryBuilder: RecordingQueryBuilder;
  updateOne: (user: User, id: RecordingId, updates: any) => Promise<boolean>;
  makeFilterOptions: (user: User, options?: { latLongPrec?: number }) => any;
  deleteOne: (user: User, id: RecordingId) => Promise<Recording | null>;
  getRecordingWithUntaggedTracks: (
    biasDeviceId?: DeviceId
  ) => Promise<TagLimitedRecording>;
  get: (
    user: User | Device,
    id: RecordingId,
    permission: RecordingPermission,
    options?: getOptions
  ) => Promise<Recording>;
  getForUser: (
    user: User,
    id: RecordingId,
    permission: RecordingPermission,
    options?: getOptions
  ) => Promise<Recording>;
  getForDevice: (
    device: Device,
    id: RecordingId,
    options?: getOptions
  ) => Promise<Recording>;

  getForAdmin: (id: RecordingId) => Promise<Recording>;
  getNextState: () => String;
  //findAll: (query: FindOptions) => Promise<Recording[]>;
}

const Op = Sequelize.Op;
export default function (
  sequelize: Sequelize.Sequelize,
  DataTypes
): RecordingStatic {
  const name = "Recording";
  const maxQueryResults = 10000;
  const attributes = {
    // recording metadata.
    type: DataTypes.STRING,
    duration: DataTypes.FLOAT,
    recordingDateTime: DataTypes.DATE,
    location: {
      type: DataTypes.GEOMETRY,
      set: util.geometrySetter,
      validate: {
        isLatLon: validation.isLatLon
      }
    },
    relativeToDawn: DataTypes.INTEGER,
    relativeToDusk: DataTypes.INTEGER,
    version: DataTypes.STRING,
    additionalMetadata: DataTypes.JSONB,
    comment: DataTypes.STRING,
    public: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },

    // Raw file data.
    rawFileKey: DataTypes.STRING,
    rawMimeType: DataTypes.STRING,
    rawFileHash: DataTypes.STRING,

    // Processing fields. Fields set by and for the processing.
    fileKey: DataTypes.STRING,
    fileMimeType: DataTypes.STRING,
    processingStartTime: DataTypes.DATE,
    processingMeta: DataTypes.JSONB,
    processingState: DataTypes.STRING,
    passedFilter: DataTypes.BOOLEAN,
    jobKey: DataTypes.STRING,

    // Battery relevant fields.
    batteryLevel: DataTypes.DOUBLE,
    batteryCharging: DataTypes.STRING,
    airplaneModeOn: DataTypes.BOOLEAN
  };

  const Recording = sequelize.define(
    name,
    attributes
  ) as unknown as RecordingStatic;

  //---------------
  // CLASS METHODS
  //---------------
  const models = sequelize.models;

  Recording.buildSafely = function (fields: Record<string, any>): Recording {
    return Recording.build(
      _.pick(fields, Recording.apiSettableFields)
    ) as Recording;
  };

  Recording.addAssociations = function (models) {
    models.Recording.belongsTo(models.Group);
    models.Recording.belongsTo(models.Device);
    models.Recording.belongsTo(models.Station);
    models.Recording.hasMany(models.Tag);
    models.Recording.hasMany(models.Track);
  };

  Recording.isValidTagMode = function (mode: TagMode) {
    return validTagModes.has(mode);
  };

  /**
   * Return a recording for processing under a transaction
   * and sets the processingStartTime and jobKey for recording
   * arguments given.
   */
  Recording.getOneForProcessing = async function (type, state) {
    return sequelize
      .transaction(function (transaction) {
        return Recording.findOne({
          where: {
            type: type,
            processingState: state,
            processingStartTime: null
          },
          attributes: [
            ...(models.Recording as RecordingStatic).processingAttributes,
            [
              Sequelize.literal(`exists(
          	select
          		1
          	from
          		"Alerts"
          	where
          		"DeviceId" = "Recording"."DeviceId"
          	limit 1)`),
              "hasAlert"
            ]
          ],
          order: [
            Sequelize.literal(`"hasAlert" DESC`),
            ["recordingDateTime", "asc"],
            ["id", "asc"] // Adding another order is a "fix" for a bug in postgresql causing the query to be slow
          ],
          // @ts-ignore
          skipLocked: true,
          lock: (transaction as any).LOCK.UPDATE,
          transaction
        }).then(async function (recording) {
          if (!recording) {
            return recording;
          }
          const date = new Date();
          recording.set(
            {
              jobKey: uuidv4(),
              processingStartTime: date.toISOString()
            },
            {
              transaction
            }
          );
          recording.save({
            transaction
          });
          return recording;
        });
      })
      .then(function (result) {
        return result;
      })
      .catch(() => {
        return null;
      });
  };

  function isUser(modelObj: any): modelObj is User {
    return (modelObj as User).username !== undefined;
  }
  function isDevice(modelObj: any): modelObj is Device {
    return (modelObj as Device).devicename !== undefined;
  }
  /**
   * Return a single recording for a user/device.
   */
  Recording.get = async function (
    modelObj: User | Device,
    id,
    permission,
    options: getOptions = {}
  ) {
    if (isUser(modelObj)) {
      return Recording.getForUser(modelObj as User, id, permission, options);
    } else if (isDevice(modelObj)) {
      return Recording.getForDevice(modelObj as Device, id, options);
    }
    return null;
  };

  /**
   * Return a single recording for a user.
   */
  Recording.getForUser = async function (
    user: User,
    id,
    permission,
    options: getOptions = {}
  ) {
    if (!RecordingPermissions.has(permission)) {
      throw "valid permission must be specified (e.g. RecordingPermission.VIEW)";
    }

    const query = {
      where: {
        [Op.and]: [
          {
            id: id
          }
        ]
      },
      include: getRecordingInclude(),
      attributes: this.userGetAttributes.concat(["rawFileKey"])
    };

    if (options.type) {
      (query.where[Op.and] as any[]).push({
        type: options.type
      });
    }

    const recording = await this.findOne(query);
    if (!recording) {
      return null;
    }
    const userPermissions = await recording.getUserPermissions(user);
    if (!userPermissions.includes(permission)) {
      throw new AuthorizationError(
        "The user does not have permission to view this file"
      );
    }
    recording.filterData(
      Recording.makeFilterOptions(user, options.filterOptions)
    );
    return recording;
  };

  /**
   * Return a single recording for an admin.
   */
  Recording.getForAdmin = async function (id) {
    const query = {
      where: {
        id: id
      },
      include: getRecordingInclude(),
      attributes: this.queryGetAttributes.concat(["rawFileKey"])
    };

    const recording = await this.findOne(query);
    if (!recording) {
      return null;
    }
    return recording;
  };

  /**
   * Return a single recording for a devce.
   */
  Recording.getForDevice = async function (
    device: Device,
    id,
    options: getOptions = {}
  ) {
    const query = {
      where: {
        [Op.and]: [
          {
            id: id,
            DeviceId: device.id
          }
        ]
      },
      include: getRecordingInclude(),
      attributes: this.userGetAttributes.concat(["rawFileKey"])
    };

    if (options.type) {
      (query.where[Op.and] as any[]).push({
        type: options.type
      });
    }

    const recording = await this.findOne(query);
    if (!recording) {
      return null;
    }

    recording.filterData(
      Recording.makeFilterOptions(null, options.filterOptions)
    );
    return recording;
  };

  /**
   * Deletes a single recording if the user has permission to do so.
   * @returns {Promise<Recording|null>} Returns the recording object if deleted, otherwise null.
   */
  Recording.deleteOne = async function (user: User, id: RecordingId) {
    const recording = await Recording.get(user, id, RecordingPermission.DELETE);
    if (!recording) {
      return null;
    }
    await recording.destroy();
    return recording;
  };

  /**
   * Updates a single recording if the user has permission to do so.
   */
  Recording.updateOne = async function (
    user: User,
    id: RecordingId,
    updates: any
  ): Promise<boolean> {
    for (const key in updates) {
      if (!apiUpdatableFields.includes(key)) {
        return false;
      }
    }

    const recording = await Recording.get(user, id, RecordingPermission.UPDATE);
    if (!recording) {
      return false;
    }
    await recording.update(updates);
    return true;
  };

  Recording.makeFilterOptions = function (user: User, options: any) {
    if (!options) {
      options = {};
    }
    if (typeof options.latLongPrec !== "number") {
      options.latLongPrec = 100;
    }
    if (!user.hasGlobalWrite()) {
      options.latLongPrec = Math.max(options.latLongPrec, 100);
    }
    return options;
  };

  // local
  const recordingsFor = async function (user: User, viewAsSuperAdmin = true) {
    if (viewAsSuperAdmin && user.hasGlobalRead()) {
      return null;
    }

    // FIXME(jon): Should really combine these into a single query?
    const [deviceIds, groupIds] = await Promise.all([
      user.getDeviceIds(),
      user.getGroupsIds()
    ]);
    return {
      [Op.or]: [
        {
          public: true
        },
        {
          GroupId: {
            [Op.in]: groupIds
          }
        },
        {
          DeviceId: {
            [Op.in]: deviceIds
          }
        }
      ]
    };
  };

  Recording.getRecordingWithUntaggedTracks = async (
    biasDeviceId: DeviceId
  ): Promise<TagLimitedRecording> => {
    // If a device id is supplied, try to bias the returned recording to that device.
    // If the requested device has no more recordings, pick another random recording.
    const [result, extra] = await sequelize.query(`
select
  g."RId" as "RecordingId",
  g."DeviceId",
  g."TrackData",
  g."TId" as "TrackId",
  g."TaggedBy",
  g."rawFileKey",
  g."rawMimeType",
  g."duration",
  g."recordingDateTime"
from (
  select *, "Tracks"."data" as "TrackData", "Tracks".id as "TId", "TrackTags".automatic as "TaggedBy" from (
    select id as "RId", "DeviceId", "rawFileKey", "rawMimeType", "recordingDateTime", "duration" from "Recordings" inner join (
      (select distinct("RecordingId") from "Tracks" inner join
        (select tId as "TrackId" from
          (
           -- TrackTags for Tracks that have *only* TrackTags that were automatically set.
           (select distinct("TrackId") as tId from "TrackTags" where automatic is true) as a
             left outer join
               (select distinct("TrackId") from "TrackTags" where automatic is false) as b
             on a.tId = b."TrackId"
          ) as c where c."TrackId" is null
        ) as d on d."TrackId" = "Tracks".id and "Tracks"."archivedAt" is null)
      union all
      -- All the recordings that have Tracks but no TrackTags
      (select "RecordingId" from "Tracks"
        left outer join "TrackTags" on "Tracks".id = "TrackTags"."TrackId"
        where "TrackTags".id is null and "Tracks"."archivedAt" is null
      )
    ) as e on e."RecordingId" = "Recordings".id ${
      biasDeviceId !== undefined ? ` where "DeviceId" = ${biasDeviceId}` : ""
    } order by RANDOM() limit 1)
  as f left outer join "Tracks" on f."RId" = "Tracks"."RecordingId" and "Tracks"."archivedAt" is null
  left outer join "TrackTags" on "TrackTags"."TrackId" = "Tracks".id and "Tracks"."archivedAt" is null
) as g;`);

    // NOTE: We bundle everything we need into this one specialised request.
    const flattenedResult = result.reduce(
      (acc, item) => {
        acc.RecordingId = item.RecordingId;
        acc.DeviceId = item.DeviceId;
        acc.fileKey = item.rawFileKey;
        acc.fileMimeType = item.rawMimeType;
        acc.recordingDateTime = item.recordingDateTime;
        acc.duration = item.duration;
        acc.tracks.push({
          TrackId: item.TrackId,
          data: {
            start_s: item.TrackData.start_s,
            end_s: item.TrackData.end_s,
            positions: item.TrackData.positions,
            num_frames: item.TrackData.num_frames
          },
          needsTagging: item.TaggedBy !== false
        });
        return acc;
      },
      {
        RecordingId: 0,
        DeviceId: 0,
        tracks: [],
        duration: 0,
        fileKey: "",
        fileMimeType: "",
        recordingDateTime: ""
      }
    );
    // Sort tracks by time, so that the front-end doesn't have to.
    flattenedResult.tracks.sort((a, b) => a.data.start_s - b.data.start_s);
    // We need to retrieve the content length of the media file in order to sign
    // the JWT token for it.
    let ContentLength = 0;
    try {
      const s3 = util.openS3();
      const s3Data = await s3
        .headObject({
          Bucket: config.s3.bucket,
          Key: flattenedResult.fileKey
        })
        .promise();
      ContentLength = s3Data.ContentLength;
    } catch (err) {
      log.warn(
        "Error retrieving S3 Object for recording",
        err.message,
        flattenedResult.fileKey
      );
    }
    const fileName = moment(new Date(flattenedResult.recordingDateTime))
      .tz(config.timeZone)
      .format("YYYYMMDD-HHmmss");

    const downloadFileData = {
      _type: "fileDownload",
      key: flattenedResult.fileKey,
      filename: `${fileName}.cptv`,
      mimeType: flattenedResult.fileMimeType
    };

    const recordingJWT = jsonwebtoken.sign(
      downloadFileData,
      config.server.passportSecret,
      { expiresIn: 60 * 10 } // Ten minutes
    );
    const tagJWT = jsonwebtoken.sign(
      {
        _type: "tagPermission",
        recordingId: flattenedResult.RecordingId
      },
      config.server.passportSecret,
      { expiresIn: 60 * 10 }
    );
    delete flattenedResult.fileKey;
    delete flattenedResult.fileMimeType;
    delete flattenedResult.recordingDateTime;
    return {
      ...flattenedResult,
      recordingJWT,
      tagJWT,
      fileSize: ContentLength
    };
  };

  //------------------
  // INSTANCE METHODS
  //------------------
  Recording.prototype.getNextState = function () {
    const jobs = Recording.processingStates[this.type];
    let nextState;
    if (this.processingState == RecordingProcessingState.Reprocess) {
      nextState = Recording.finishedState(this.type);
    } else {
      const job_index = jobs.indexOf(this.processingState);
      if (job_index == -1) {
        throw new Error(`Recording state unknown - ${this.processState}`);
      } else if (job_index < jobs.length - 1) {
        nextState = jobs[job_index + 1];
      } else {
        nextState = this.processingState;
      }
    }
    return nextState;
  };

  Recording.prototype.setStation = async function (station: { id: number }) {
    this.StationId = station.id;
    return this.save();
  };

  Recording.prototype.getFileBaseName = function (): string {
    return moment(new Date(this.recordingDateTime))
      .tz(config.timeZone)
      .format("YYYYMMDD-HHmmss");
  };

  Recording.prototype.getRawFileName = function () {
    return this.getFileBaseName() + this.getRawFileExt();
  };

  Recording.prototype.getFileName = function () {
    return this.getFileBaseName() + this.getFileExt();
  };

  Recording.prototype.getRawFileExt = function () {
    if (this.rawMimeType == "application/x-cptv") {
      return ".cptv";
    }
    const ext = mime.getExtension(this.rawMimeType);
    if (ext) {
      return "." + ext;
    }
    switch (this.type) {
      case "thermalRaw":
        return ".cptv";
      case "audio":
        return ".mpga";
      default:
        return "";
    }
  };

  /* eslint-disable indent */
  Recording.prototype.getActiveTracksTagsAndTagger =
    async function (): Promise<any> {
      return await this.getTracks({
        where: {
          archivedAt: null
        },
        include: [
          {
            model: models.TrackTag,
            include: [
              {
                model: models.User,
                attributes: ["username"]
              }
            ],
            attributes: {
              exclude: ["UserId"]
            }
          }
        ]
      });
    };
  /* eslint-enable indent */

  /**
   * TODO This will be edited in the future when recordings can be public.
   */
  Recording.prototype.getUserPermissions = async function (
    user: User
  ): Promise<RecordingPermission[]> {
    if (
      user.hasGlobalWrite() ||
      (await user.isInGroup(this.GroupId)) ||
      (await user.canAccessDevice(this.Device.id))
    ) {
      return [...RecordingPermissions.values()];
    }
    if (user.hasGlobalRead()) {
      return [RecordingPermission.VIEW];
    }
    return [];
  };

  // Bulk update recording values. Any new additionalMetadata fields
  // will be merged.
  Recording.prototype.mergeUpdate = async function (newValues): Promise<void> {
    for (const [name, newValue] of Object.entries(newValues)) {
      if (name == "additionalMetadata") {
        this.mergeAdditionalMetadata(newValue);
      } else {
        this.set(name, newValue);
        if (name === "location") {
          // NOTE: When location gets updated, we need to update any matching stations for this recordings' group.
          const matchingStation = await tryToMatchRecordingToStation(this);
          if (matchingStation) {
            this.set("StationId", matchingStation.id);
          }
        }
      }
    }
  };

  // Update additionalMetadata fields with new values supplied.
  Recording.prototype.mergeAdditionalMetadata = function (newValues) {
    this.additionalMetadata = { ...this.additionalMetadata, ...newValues };
  };

  Recording.prototype.getFileExt = function () {
    if (this.fileMimeType == "application/x-cptv") {
      return ".cptv";
    }
    const ext = mime.getExtension(this.fileMimeType);
    if (ext) {
      return "." + ext;
    }
    return "";
  };

  Recording.prototype.filterData = function (options: { latLongPrec: any }) {
    if (this.location) {
      this.location.coordinates = reduceLatLonPrecision(
        this.location.coordinates,
        options.latLongPrec
      );
    }
  };

  function reduceLatLonPrecision(latLon, prec) {
    assert(latLon.length == 2);
    const resolution = (prec * 360) / 40000000;
    const half_resolution = resolution / 2;
    return latLon.map((val) => {
      val = val - (val % resolution);
      if (val > 0) {
        val += half_resolution;
      } else {
        val -= half_resolution;
      }
      return val;
    });
  }

  // Returns all active tracks for the recording which are not archived.
  Recording.prototype.getActiveTracks = async function () {
    return await this.getTracks({
      where: {
        archivedAt: null
      },
      include: [
        {
          model: models.TrackTag
        }
      ]
    });
  };

  // reprocess a recording and set all active tracks to archived
  Recording.prototype.reprocess = async function () {
    const tags = await this.getTags();
    if (tags.length > 0) {
      const meta = this.additionalMetadata || {};
      meta["oldTags"] = tags;
      this.additionalMetadata = meta;
      await this.save();
    }

    await models.Tag.destroy({
      where: {
        RecordingId: this.id
      }
    });

    models.Track.update(
      {
        archivedAt: Date.now()
      },
      {
        where: {
          RecordingId: this.id,
          archivedAt: null
        }
      }
    );
    await this.update({
      processingStartTime: null,
      processingState: RecordingProcessingState.Reprocess
    });
  };

  // Return a specific track for the recording.
  Recording.prototype.getTrack = async function (
    trackId: TrackId
  ): Promise<Track | null> {
    const track = await models.Track.findByPk(trackId);
    if (!track) {
      return null;
    }

    // Ensure track belongs to this recording.
    if (track.RecordingId !== this.id) {
      return null;
    }
    return track;
  };

  Recording.queryBuilder = function () {} as unknown as RecordingQueryBuilder;

  Recording.queryBuilder.prototype.init = async function (
    user,
    where,
    tagMode,
    tags,
    offset,
    limit,
    order,
    viewAsSuperAdmin = true
  ) {
    if (!where) {
      where = {};
    }

    delete where._tagged; // remove legacy tag mode selector (if included)

    if (!offset) {
      offset = 0;
    }
    if (!limit) {
      limit = 300;
    } else {
      limit = Math.min(limit, maxQueryResults);
    }
    if (!order) {
      order = [
        // Sort by recordingDatetime but handle the case of the
        // timestamp being missing and fallback to sorting by id.
        [
          Sequelize.fn(
            "COALESCE",
            Sequelize.col("recordingDateTime"),
            "1970-01-01"
          ),
          "DESC"
        ],
        ["id", "DESC"]
      ];
    }
    this.query = {
      where: {
        [Op.and]: [
          where, // User query
          await recordingsFor(user, viewAsSuperAdmin),
          Sequelize.literal(Recording.queryBuilder.handleTagMode(tagMode, tags))
        ]
      },
      order: order,
      include: getRecordingInclude(),
      limit: limit,
      offset: offset,
      attributes: Recording.queryGetAttributes
    };
    return this;
  };

  function getRecordingInclude() {
    return [
      {
        model: models.Group,
        attributes: ["groupname"]
      },
      {
        model: models.Station,
        attributes: ["name", "location"]
      },
      {
        model: models.Tag,
        attributes: (models.Tag as TagStatic).userGetAttributes,
        include: [
          {
            association: "tagger",
            attributes: ["username", "id"]
          }
        ]
      },
      {
        model: models.Track,
        where: {
          archivedAt: null
        },
        attributes: [
          "id",
          [
            Sequelize.fn(
              "json_build_object",
              "start_s",
              Sequelize.literal(`"Tracks"."data"#>'{start_s}'`),
              "end_s",
              Sequelize.literal(`"Tracks"."data"#>'{end_s}'`)
            ),
            "data"
          ]
        ],

        required: false,
        include: [
          {
            model: models.TrackTag,
            attributes: [
              "what",
              "automatic",
              "TrackId",
              "confidence",
              "UserId",
              [Sequelize.json("data.name"), "data"]
            ],
            include: [
              {
                model: models.User,
                attributes: ["username", "id"]
              }
            ],
            required: false
          }
        ]
      },
      {
        model: models.Device,
        where: {},
        attributes: ["devicename", "id"]
      }
    ];
  }

  Recording.queryBuilder.handleTagMode = (
    tagMode: AllTagModes,
    tagWhatsIn: string[]
  ): SqlString => {
    const tagWhats = tagWhatsIn && tagWhatsIn.length > 0 ? tagWhatsIn : null;
    if (!tagMode) {
      tagMode = tagWhats ? TagMode.Tagged : TagMode.Any;
    }

    const humanSQL = 'NOT "Tags".automatic';
    const AISQL = '"Tags".automatic';
    if (
      (models.Tag as TagStatic).acceptableTags.has(tagMode as AcceptableTag)
    ) {
      let sqlQuery = `(EXISTS (${Recording.queryBuilder.recordingTaggedWith(
        [tagMode],
        null
      )}))`;
      if (tagWhats) {
        sqlQuery = `${sqlQuery} AND EXISTS(${Recording.queryBuilder.trackTaggedWith(
          tagWhats,
          null
        )})`;
      }
      return sqlQuery;
    }

    switch (tagMode) {
      case "any":
        return "";
      case "untagged":
        return Recording.queryBuilder.notTagOfType(tagWhats, null);
      case "tagged":
        return Recording.queryBuilder.tagOfType(tagWhats, null);
      case "human-tagged":
        return Recording.queryBuilder.tagOfType(tagWhats, humanSQL);
      case "automatic-tagged":
        return Recording.queryBuilder.tagOfType(tagWhats, AISQL);
      case "both-tagged":
        return `${Recording.queryBuilder.tagOfType(
          tagWhats,
          humanSQL
        )} AND ${Recording.queryBuilder.tagOfType(tagWhats, AISQL)}`;
      case "no-human":
        return Recording.queryBuilder.notTagOfType(tagWhats, humanSQL);
      case "automatic-only":
        return `${Recording.queryBuilder.tagOfType(
          tagWhats,
          AISQL
        )} AND ${Recording.queryBuilder.notTagOfType(tagWhats, humanSQL)}`;
      case "human-only":
        return `${Recording.queryBuilder.tagOfType(
          tagWhats,
          humanSQL
        )} AND ${Recording.queryBuilder.notTagOfType(tagWhats, AISQL)}`;
      case "automatic+human":
        return `${Recording.queryBuilder.tagOfType(
          tagWhats,
          humanSQL
        )} AND ${Recording.queryBuilder.tagOfType(tagWhats, AISQL)}`;
      default: {
        throw `invalid tag mode: ${tagMode}`;
      }
    }
  };

  Recording.queryBuilder.tagOfType = (
    tagWhats: string[],
    tagTypeSql
  ): SqlString => {
    let query = `( EXISTS(${Recording.queryBuilder.trackTaggedWith(
      tagWhats,
      tagTypeSql
    )})`;
    if (
      !tagWhats ||
      (!tagWhats && tagTypeSql) ||
      tagWhats.find((tag) =>
        (models.Tag as TagStatic).acceptableTags.has(tag as AcceptableTag)
      )
    ) {
      query += ` OR EXISTS (${Recording.queryBuilder.recordingTaggedWith(
        tagWhats,
        tagTypeSql
      )})`;
    }
    query += ")";
    return query;
  };

  Recording.queryBuilder.notTagOfType = (
    tagWhats: string[],
    tagTypeSql
  ): SqlString => {
    let query = `( NOT EXISTS(${Recording.queryBuilder.trackTaggedWith(
      tagWhats,
      tagTypeSql
    )})`;
    if (
      !tagWhats ||
      (!tagWhats && tagTypeSql) ||
      tagWhats.find((tag) =>
        (models.Tag as TagStatic).acceptableTags.has(tag as AcceptableTag)
      )
    ) {
      query += ` AND NOT EXISTS (${Recording.queryBuilder.recordingTaggedWith(
        tagWhats,
        tagTypeSql
      )})`;
    }
    query += ")";
    return query;
  };

  Recording.queryBuilder.recordingTaggedWith = (
    tags: (TagMode | AcceptableTag)[],
    tagTypeSql
  ) => {
    let sql =
      'SELECT "Recording"."id" FROM "Tags" WHERE  "Tags"."RecordingId" = "Recording".id';
    if (tags) {
      sql += ` AND (${Recording.queryBuilder.selectByTagWhat(
        tags,
        "what",
        true
      )})`;
    }
    if (tagTypeSql) {
      sql += ` AND (${tagTypeSql})`;
    }
    return sql;
  };

  Recording.queryBuilder.trackTaggedWith = (
    tags?: (TagMode | AcceptableTag)[],
    tagTypeSql?
  ) => {
    let sql = `SELECT "Recording"."id" FROM "Tracks" INNER JOIN "TrackTags" AS "Tags" ON "Tracks"."id" = "Tags"."TrackId" WHERE "Tracks"."RecordingId" = "Recording".id AND "Tracks"."archivedAt" IS NULL`;
    if (tags) {
      sql += ` AND (${Recording.queryBuilder.selectByTagWhat(
        tags,
        "what",
        false
      )})`;
    }
    if (tagTypeSql) {
      sql += ` AND (${tagTypeSql})`;
    }
    return sql;
  };

  Recording.queryBuilder.selectByTagWhat = (
    tags: string[],
    whatName: string,
    usesDetail: boolean
  ) => {
    if (!tags || tags.length === 0) {
      return null;
    }

    const parts = [];
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i];
      if (tag === "interesting") {
        if (usesDetail) {
          parts.push(
            `(("Tags"."${whatName}" IS NULL OR "Tags"."${whatName}"!='bird') AND ("Tags"."detail" IS NULL OR "Tags"."detail"!='false positive'))`
          );
        } else {
          parts.push(
            `("Tags"."${whatName}"!='bird' AND "Tags"."${whatName}"!='false positive')`
          );
        }
      } else {
        parts.push(`"Tags"."${whatName}" = '${tag}'`);
        if (usesDetail) {
          // the label could also be the detail field not the what field
          parts.push(`"Tags"."detail" = '${tag}'`);
        }
      }
    }
    return parts.join(" OR ");
  };

  Recording.queryBuilder.prototype.get = function () {
    return this.query;
  };

  Recording.queryBuilder.prototype.addColumn = function (name: string) {
    this.query.attributes.push(name);
    return this;
  };

  // Include details of recent audio bait events in the query output.
  Recording.queryBuilder.prototype.addAudioEvents = function (
    after?: string,
    before?: string
  ) {
    if (!after) {
      after = '"Recording"."recordingDateTime" - interval \'30 minutes\'';
    }
    if (!before) {
      before = '"Recording"."recordingDateTime"';
    }
    const deviceInclude = this.findInclude(models.Device as DeviceStatic);

    if (!deviceInclude.include) {
      deviceInclude.include = {};
    }
    deviceInclude.include = [
      {
        model: models.Event,
        required: false,
        where: {
          dateTime: {
            [Op.between]: [Sequelize.literal(after), Sequelize.literal(before)]
          }
        },
        include: [
          {
            model: models.DetailSnapshot,
            as: "EventDetail",
            required: false,
            where: {
              type: "audioBait"
            },
            attributes: ["details"]
          }
        ]
      }
    ];

    return this;
  };

  Recording.queryBuilder.prototype.findInclude = function (
    modelType: ModelStaticCommon<any>
  ): Includeable[] {
    for (const inc of this.query.include) {
      if (inc.model === modelType) {
        return inc;
      }
    }
    throw `could not find query include for ${modelType}`;
  };

  // Attributes returned in recording query results.
  Recording.queryGetAttributes = [
    "id",
    "type",
    "recordingDateTime",
    "rawMimeType",
    "fileMimeType",
    "processingState",
    "duration",
    "location",
    "batteryLevel",
    "DeviceId",
    "GroupId",
    "StationId"
  ];

  // Attributes returned when looking up a single recording.
  Recording.userGetAttributes = [
    "id",
    "rawMimeType",
    "fileMimeType",
    "processingState",
    "duration",
    "recordingDateTime",
    "relativeToDawn",
    "relativeToDusk",
    "location",
    "version",
    "batteryLevel",
    "batteryCharging",
    "airplaneModeOn",
    "type",
    "additionalMetadata",
    "GroupId",
    "StationId",
    "fileKey",
    "comment"
  ];

  // Fields that can be provided when uploading new recordings.
  Recording.apiSettableFields = [
    "type",
    "duration",
    "recordingDateTime",
    "relativeToDawn",
    "relativeToDusk",
    "location",
    "version",
    "batteryCharging",
    "batteryLevel",
    "airplaneModeOn",
    "additionalMetadata",
    "processingMeta",
    "comment",
    "StationId"
  ];

  // local
  const apiUpdatableFields = ["location", "comment", "additionalMetadata"];

  Recording.processingStates = {
    thermalRaw: [
      RecordingProcessingState.AnalyseThermal,
      RecordingProcessingState.Finished
    ],
    audio: [
      RecordingProcessingState.ToMp3,
      RecordingProcessingState.Analyse,
      RecordingProcessingState.Finished
    ]
  };

  Recording.uploadedState = function (type: RecordingType) {
    if (type == RecordingType.Audio) {
      return RecordingProcessingState.ToMp3;
    } else {
      return RecordingProcessingState.AnalyseThermal;
    }
  };
  Recording.finishedState = function (type: RecordingType) {
    if (type == RecordingType.Audio) {
      return RecordingProcessingState.Finished;
    } else {
      return RecordingProcessingState.Finished;
    }
  };
  Recording.processingAttributes = [
    "id",
    "type",
    "jobKey",
    "rawFileKey",
    "rawMimeType",
    "fileKey",
    "fileMimeType",
    "processingState",
    "processingMeta",
    "GroupId",
    "DeviceId",
    "StationId",
    "recordingDateTime",
    "duration",
    "location"
  ];

  return Recording;
}
