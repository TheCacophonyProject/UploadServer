// load the global Cypress types
/// <reference types="cypress" />

import { uploadFile } from "../fileUpload";
import { v1ApiPath, DEFAULT_DATE, makeAuthorizedRequest } from "../server";
import { logTestDescription, prettyLog } from "../descriptions";
import { convertToDate } from "../server";

let lastUsedTime = DEFAULT_DATE;

Cypress.Commands.add(
  "uploadRecording",
  (cameraName: string, details: ThermalRecordingInfo, log: boolean = true) => {
    const data = makeRecordingDataFromDetails(details);

    logTestDescription(
      `Upload recording ${prettyLog(details)}  to '${cameraName}'`,
      { camera: cameraName, requestData: data },
      log
    );

    const fileName = "invalid.cptv";
    const url = v1ApiPath("recordings");
    const fileType = "application/cptv";

    uploadFile(url, cameraName, fileName, fileType, data, "@addRecording").then(
      (x) => {
        cy.wrap(x.response.body.recordingId);
      }
    );
  }
);

Cypress.Commands.add(
  "uploadRecordingsAtTimes",
  (cameraName: string, times: string[]) => {
    logTestDescription(
      `Upload recordings   at ${prettyLog(times)}  to '${cameraName}'`,
      { camera: cameraName, times }
    );

    times.forEach((time) => {
      cy.uploadRecording(cameraName, { time }, false);
    });
  }
);

Cypress.Commands.add(
  "userTagRecording",
  (recordingId: number, trackIndex: number, tagger: string, tag: string) => {
    logTestDescription(`User '${tagger}' tags recording as '${tag}'`, {
      recordingId,
      trackIndex,
      tagger,
      tag
    });

    makeAuthorizedRequest(
      {
        method: "GET",
        url: v1ApiPath(`recordings/${recordingId}/tracks`)
      },
      tagger
    ).then((response) => {
      makeAuthorizedRequest(
        {
          method: "POST",
          url: v1ApiPath(
            `recordings/${recordingId}/tracks/${response.body.tracks[trackIndex].id}/replaceTag`
          ),
          body: { what: tag, confidence: 0.7, automatic: false }
        },
        tagger
      );
    });
  }
);

Cypress.Commands.add(
  "thenUserTagAs",
  { prevSubject: true },
  (subject, tagger: string, tag: string) => {
    cy.userTagRecording(subject, 0, tagger, tag);
  }
);

Cypress.Commands.add(
  "uploadRecordingThenUserTag",
  (
    camera: string,
    details: ThermalRecordingInfo,
    tagger: string,
    tag: string
  ) => {
    cy.uploadRecording(camera, details).then((inter) => {
      cy.userTagRecording(inter.response.body.recordingId, 0, tagger, tag);
    });
  }
);

type IsoFormattedDateString = string;

interface TrackData {
  start_s?: number;
  end_s?: number;
  confident_tag?: string;
  confidence?: number;
}

interface AlgorithmMetadata {
  model_name?: string;
}

interface ThermalRecordingMetaData {
  algorithm?: AlgorithmMetadata;
  tracks: TrackData[];
}

interface ThermalRecordingData {
  type: "thermalRaw";
  recordingDateTime: IsoFormattedDateString;
  duration: number;
  comment?: string;
  batteryLevel?: number;
  batteryCharging?: string;
  airplaneModeOn?: boolean;
  version?: string;
  additionalMetadata?: JSON;
  metadata?: ThermalRecordingMetaData;
  location?: number[];
}

function makeRecordingDataFromDetails(
  details: ThermalRecordingInfo
): ThermalRecordingData {
  let data: ThermalRecordingData = {
    type: "thermalRaw",
    recordingDateTime: "",
    duration: 12,
    comment: "uploaded by cypress"
  };

  if (details.duration) {
    data.duration = details.duration;
  }

  data.recordingDateTime = getDateForRecordings(details).toISOString();

  if (!details.noTracks) {
    const model = details.model ? details.model : "Master";
    addTracksToRecording(data, model, details.tracks, details.tags);
  }

  if (details.lat && details.lng) {
    data.location = [details.lat, details.lng];
  }
  if (details.processingState) {
    data.processingState = details.processingState;
  }
  return data;
}

function getDateForRecordings(details: ThermalRecordingInfo): Date {
  let date = lastUsedTime;

  if (details.time) {
    date = convertToDate(details.time);
  } else if (details.minsLater || details.secsLater) {
    let secs = 0;
    if (details.minsLater) {
      secs += details.minsLater * 60;
    }
    if (details.secsLater) {
      secs += details.secsLater;
    }
    date = new Date(date.getTime() + secs * 1000);
  } else {
    // add a minute anyway so we don't get two overlapping recordings on the same camera
    const MINUTE = 60;
    date = new Date(date.getTime() + MINUTE * 1000);
  }

  lastUsedTime = date;
  return date;
}

function addTracksToRecording(
  data: ThermalRecordingData,
  model: string,
  trackDetails?: TrackInfo[],
  tags?: string[]
): void {
  data.metadata = {
    algorithm: {
      model_name: model
    },
    tracks: []
  };

  if (tags && !trackDetails) {
    trackDetails = tags.map((tag) => ({ tag }));
  }

  if (trackDetails) {
    let count = 0;
    data.metadata.tracks = trackDetails.map((track) => {
      let tag = track.tag ? track.tag : "possum";
      return {
        start_s: track.start_s || 2 + count * 10,
        end_s: track.end_s || 8 + count * 10,
        confident_tag: tag,
        confidence: 0.9
      };
    });
    count++;
  } else {
    data.metadata.tracks.push({
      start_s: 2,
      end_s: 8,
      confident_tag: "possum",
      confidence: 0.5
    });
  }
}

export function addSeconds(initialTime: Date, secondsToAdd: number): Date {
  const AS_MILLISECONDS = 1000;
  return new Date(initialTime.getTime() + secondsToAdd * AS_MILLISECONDS);
}
