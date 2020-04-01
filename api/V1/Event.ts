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

import middleware from "../middleware";
import auth from "../auth";
import models from "../../models";
import responseUtil from "./responseUtil";
import { param, body, oneOf, query } from "express-validator/check";
import { Application } from "express";
import eventUtil from "./eventUtil";

export default function(app: Application, baseUrl: string) {
  const apiUrl = `${baseUrl}/events`;

  /**
   * @api {post} /api/v1/events Add new events
   * @apiName Add Event
   * @apiGroup Events
   * @apiDescription This call is used to upload new events.
   * The event can be described by specifying an existing eventDetailId or by
   * the 'description' parameter.
   *
   * `Either eventDetailId or description is required`
   * @apiUse V1DeviceAuthorizationHeader
   *
   * @apiUse EventParams
   * @apiUse EventExampleDescription
   * @apiUse EventExampleEventDetailId
   *
   * @apiUse V1ResponseSuccess
   * @apiSuccess {Integer} eventsAdded Number of events added
   * @apiSuccess {Integer} eventDetailId Id of the Event Detail record used.  May be existing or newly created
   * @apiuse V1ResponseError
   */
  app.post(
    apiUrl,
    [auth.authenticateDevice, ...eventUtil.eventAuth],
    middleware.requestWrapper(eventUtil.uploadEvent)
  );

  /**
   * @api {post} /api/v1/events/device/:deviceID Add new events on behalf of device
   * @apiName AddEventOnBehalf
   * @apiGroup Events
   * @apiDescription This call is used to upload new events on behalf of a device.
   * The event can be described by specifying an existing eventDetailId or by
   * the 'description' parameter.
   *
   * `Either eventDetailId or description is required`
   * @apiParam {String} deviceID ID of the device to upload on behalf of. If you don't have access to the ID the devicename can be used instead in it's place.
   * @apiUse V1UserAuthorizationHeader
   *
   * @apiUse EventParams
   * @apiUse EventExampleDescription
   * @apiUse EventExampleEventDetailId
   *
   * @apiUse V1ResponseSuccess
   * @apiSuccess {Integer} eventsAdded Number of events added
   * @apiSuccess {Integer} eventDetailId Id of the Event Detail record used.  May be existing or newly created
   * @apiuse V1ResponseError
   */
  app.post(
    apiUrl + "/device/:deviceID",
    [
      auth.authenticateUser,
      middleware.getDevice(param, "deviceID"),
      auth.userCanAccessDevices,
      ...eventUtil.eventAuth
    ],
    middleware.requestWrapper(eventUtil.uploadEvent)
  );

  /**
   * @api {get} /api/v1/events Query recorded events
   * @apiName QueryEvents
   * @apiGroup Events
   *
   * @apiUse V1UserAuthorizationHeader
   * @apiParam {Datetime} [startTime] Return only events after this time
   * @apiParam {Datetime} [endTime] Return only events from before this time
   * @apiParam {Integer} [deviceId] Return only events for this device id
   * @apiParam {Integer} [limit] Limit returned events to this number (default is 100)
   * @apiParam {Integer} [offset] Offset returned events by this amount (default is 0)
   *
   * @apiSuccess {JSON} rows Array containing details of events matching the criteria given.
   * @apiUse V1ResponseError
   */
  app.get(
    apiUrl,
    [
      auth.authenticateUser,
      query("startTime")
        // @ts-ignore
        .isISO8601({ strict: true })
        .optional(),
      query("endTime")
        // @ts-ignore
        .isISO8601({ strict: true })
        .optional(),
      query("deviceId")
        .isInt()
        .optional()
        .toInt(),
      query("offset")
        .isInt()
        .optional()
        .toInt(),
      query("limit")
        .isInt()
        .optional()
        .toInt()
    ],
    middleware.requestWrapper(async (request, response) => {
      const query = request.query;
      query.offset = query.offset || 0;
      query.limit = query.limit || 100;

      const result = await models.Event.query(
        request.user,
        query.startTime,
        query.endTime,
        query.deviceId,
        query.offset,
        query.limit
      );

      return responseUtil.send(response, {
        statusCode: 200,
        messages: ["Completed query."],
        limit: query.limit,
        offset: query.offset,
        count: result.count,
        rows: result.rows
      });
    })
  );
}
