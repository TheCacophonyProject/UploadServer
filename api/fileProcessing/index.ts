import responseUtil from "../V1/responseUtil";
import middleware from "../middleware";
import log from "../../logging";
import { body, param } from "express-validator/check";
import models from "../../models";
import recordingUtil from "../V1/recordingUtil";
import { Application, Request, Response } from "express";
import {
  Recording,
  RecordingProcessingState,
  RecordingType
} from "../../models/Recording";

export default function (app: Application) {
  const apiUrl = "/api/fileProcessing";

  /**
   * @api {get} /api/fileProcessing Get a new file processing job
   * @apiName getNewFileProcessingJob
   * @apiGroup FileProcessing
   *
   * @apiParam {String} type Type of recording.
   * @apiParam {String} state Processing state.
   */
  app.get(apiUrl, async (request: Request, response: Response) => {
    log.info(`${request.method} Request: ${request.url}`);
    const type = request.query.type as RecordingType;
    const state = request.query.state as RecordingProcessingState;
    const recording = await models.Recording.getOneForProcessing(type, state);
    if (recording == null) {
      log.debug("No file to be processed.");
      return response.status(204).json();
    } else {
      return response.status(200).json({
        // FIXME(jon): Test that dataValues is even a thing.  It's not a publicly
        //  documented sequelize property.
        recording: (recording as any).dataValues
      });
    }
  });

  /**
   * @api {put} /api/fileProcessing Finished a file processing job
   * @apiName finishedFileProcessingJob
   * @apiGroup FileProcessing
   *
   * @apiParam {Integer} id ID of the recording.
   * @apiParam {String} jobKey Key given when requesting the job.
   * @apiParam {Boolean} success If the job was finished successfully.
   * @apiParam {JSON} [result] Result of the file processing
   * @apiParam {Boolean} complete true if the processing is complete, or false if file will be processed further.
   * @apiParam {String} [newProcessedFileKey] LeoFS Key of the new file.
   */
  app.put(apiUrl, async (request: Request, response: Response) => {
    const id = parseInt(request.body.id);
    const jobKey = request.body.jobKey;
    const success = middleware.parseBool(request.body.success);
    let result = request.body.result;
    const complete = middleware.parseBool(request.body.complete);
    const newProcessedFileKey = request.body.newProcessedFileKey;

    // Validate request.
    const errorMessages = [];
    if (isNaN(id)) {
      errorMessages.push("'id' field needs to be a number.");
    }
    if (jobKey == null) {
      errorMessages.push("'jobKey' field is required.");
    }
    if (success == null) {
      errorMessages.push("'success' field is required");
    }
    if (result != null) {
      try {
        result = JSON.parse(result);
      } catch (e) {
        errorMessages.push("'result' field was not a valid JSON.");
      }
    }

    if (errorMessages.length > 0) {
      return response.status(400).json({
        messages: errorMessages
      });
    }

    const recording = await models.Recording.findOne({ where: { id: id } });
    if (!recording) {
      return response.status(400).json({
        messages: [`Recording ${id} not found for jobKey ${jobKey}`]
      });
    }

    // Check that jobKey is correct.
    if (jobKey != recording.get("jobKey")) {
      return response.status(400).json({
        messages: ["'jobKey' given did not match the database.."]
      });
    }

    if (success) {
      if (newProcessedFileKey) {
        recording.set("fileKey", newProcessedFileKey);
      }
      if (complete) {
        if (recording.processingState != RecordingProcessingState.Reprocess) {
          await recordingUtil.sendAlerts(recording.id);
        }

        recording.set("jobKey", null);
        recording.set("processingStartTime", null);
      }
      const nextJob = recording.getNextState();
      recording.set("processingState", nextJob);
      // Process extra data from file processing
      if (result && result.fieldUpdates) {
        await recording.mergeUpdate(result.fieldUpdates);
      }
      await recording.save();

      if ((recording as Recording).type === RecordingType.ThermalRaw) {
        // TODO:
        // Pick a thumbnail image from the best frame here, and upload it to minio using fileKey, since we are no
        // longer using that for mp4s
        // .....
        // Send alerts for best track tag here - it can use the thumbnail image in the email generated.
        // .....
      }

      return response.status(200).json({ messages: ["Processing finished."] });
    } else {
      recording.set("processingState", recording.processingState + ".failed");
      recording.set("jobKey", null);
      await recording.save();
      return response.status(200).json({
        messages: ["Processing failed."]
      });
    }
  });

  /**
   * @api {post} /api/fileProcessing/tags Add a tag to a recording
   * @apiName tagRecordingAfterFileProcessing
   * @apiGroup FileProcessing
   *
   * @apiDescription This call takes a `tag` field which contains a JSON
   * object string containing a number of fields. See /api/V1/tags for
   * more details.
   *
   * @apiParam {Number} recordingId ID of the recording that you want to tag.
   * @apiparam {JSON} tag Tag data in JSON format.
   *
   * @apiUse V1ResponseSuccess
   * @apiSuccess {Number} tagId ID of the tag just added.
   *
   * @apiuse V1ResponseError
   *
   */
  app.post(
    `${apiUrl}/tags`,
    [middleware.parseJSON("tag", body), body("recordingId").isInt()],
    middleware.requestWrapper(async (request, response) => {
      const options = {
        include: [
          { model: models.Device, where: {}, attributes: ["devicename", "id"] }
        ]
      };
      const recording = await models.Recording.findByPk(
        request.body.recordingId,
        options
      );
      await recordingUtil.addTag(null, recording, request.body.tag, response);
    })
  );

  /**
   * @api {post} /api/fileProcessing/metadata Updates the metadata for the recording
   * @apiName updateMetaData
   * @apiGroup FileProcessing
   *
   * @apiDescription This call updates the metadata for a recording
   *
   * @apiParam {Number} recordingId ID of the recording that you want to tag.
   * @apiparam {JSON} metadata Metadata to be updated for the recording.  See /api/V1/recording for more details
   *
   * @apiUse V1ResponseSuccess
   *
   * @apiuse V1ResponseError
   *
   */
  app.post(
    `${apiUrl}/metadata`,
    [middleware.getRecordingById(body), middleware.parseJSON("metadata", body)],
    middleware.requestWrapper(async (request) => {
      await recordingUtil.updateMetadata(
        request.body.recording,
        request.body.metadata
      );
    })
  );

  /**
   * @api {post} /api/fileProcessing/:id/tracks Add track to recording
   * @apiName PostTrack
   * @apiGroup FileProcessing
   *
   * @apiParam {JSON} data Data which defines the track (type specific).
   * @apiParam {Number} AlgorithmId Database Id of the Tracking algorithm details retrieved from
   * (#FileProcessing:Algorithm) request
   *
   * @apiUse V1ResponseSuccess
   * @apiSuccess {int} trackId Unique id of the newly created track.
   *
   * @apiuse V1ResponseError
   *
   */
  app.post(
    `${apiUrl}/:id/tracks`,
    [
      param("id").isInt().toInt(),
      middleware.parseJSON("data", body),
      middleware.getDetailSnapshotById(body, "algorithmId")
    ],
    middleware.requestWrapper(async (request: Request, response) => {
      const recording = await models.Recording.findByPk(request.params.id);
      if (!recording) {
        responseUtil.send(response, {
          statusCode: 400,
          messages: ["No such recording."]
        });
        return;
      }
      const track = await recording.createTrack({
        data: request.body.data,
        AlgorithmId: request.body.algorithmId
      });
      responseUtil.send(response, {
        statusCode: 200,
        messages: ["Track added."],
        trackId: track.id
      });
    })
  );

  /**
   * @api {delete} /api/fileProcessing/:id/tracks Delete all tracks for a recording
   * @apiName DeleteTracks
   * @apiGroup FileProcessing
   *
   * @apiUse V1ResponseSuccess
   *
   * @apiuse V1ResponseError
   *
   */
  app.delete(
    `${apiUrl}/:id/tracks`,
    [param("id").isInt().toInt()],
    middleware.requestWrapper(async (request, response) => {
      const recording = await models.Recording.findByPk(request.params.id);
      if (!recording) {
        responseUtil.send(response, {
          statusCode: 400,
          messages: ["No such recording."]
        });
        return;
      }

      const tracks = await recording.getTracks();
      tracks.forEach((track) => track.destroy());

      responseUtil.send(response, {
        statusCode: 200,
        messages: ["Tracks cleared."]
      });
    })
  );

  /**
   * @api {post} /api/v1/recordings/:id/tracks/:trackId/tags Add tag to track
   * @apiName PostTrackTag
   * @apiGroup FileProcessing
   *
   * @apiParam {String} what Object/event to tag.
   * @apiParam {Number} confidence Tag confidence score.
   * @apiParam {JSON} data Data Additional tag data.
   *
   * @apiUse V1ResponseSuccess
   * @apiSuccess {int} trackTagId Unique id of the newly created track tag.
   *
   * @apiUse V1ResponseError
   */
  app.post(
    `${apiUrl}/:id/tracks/:trackId/tags`,
    [
      param("id").isInt().toInt(),
      param("trackId").isInt().toInt(),
      body("what"),
      body("confidence").isFloat().toFloat(),
      middleware.parseJSON("data", body).optional()
    ],
    middleware.requestWrapper(async (request, response) => {
      const recording = await models.Recording.findByPk(request.params.id);
      if (!recording) {
        responseUtil.send(response, {
          statusCode: 400,
          messages: ["No such recording."]
        });
        return;
      }

      const track = await recording.getTrack(request.params.trackId);
      if (!track) {
        responseUtil.send(response, {
          statusCode: 400,
          messages: ["No such track."]
        });
        return;
      }

      const tag = await track.addTag(
        request.body.what,
        request.body.confidence,
        true,
        request.body.data
      );
      responseUtil.send(response, {
        statusCode: 200,
        messages: ["Track tag added."],
        trackTagId: tag.id
      });
    })
  );

  /**
   * @api {post} /algorithm Finds matching existing algorithm definition or adds a new one to the database
   * @apiName Algorithm
   * @apiGroup FileProcessing
   *
   * @apiParam {JSON} algorithm algorithm data in tag form.
   *
   * @apiUse V1ResponseSuccess
   * @apiSuccess {int} algorithmId Id of the matching algorithm tag.
   *
   * @apiUse V1ResponseError
   */
  app.post(
    `${apiUrl}/algorithm`,
    [middleware.parseJSON("algorithm", body)],
    middleware.requestWrapper(async (request, response) => {
      const algorithm = await models.DetailSnapshot.getOrCreateMatching(
        "algorithm",
        request.body.algorithm
      );

      responseUtil.send(response, {
        statusCode: 200,
        messages: ["Algorithm key retrieved."],
        algorithmId: algorithm.id
      });
    })
  );
}
