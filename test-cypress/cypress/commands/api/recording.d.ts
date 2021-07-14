// load the global Cypress types
/// <reference types="cypress" />

interface TrackInfo {
  start_s?: number;
  end_s?: number;
  tag?: string;
  // confidence?: number,
}

interface ThermalRecordingInfo {
  processingState: string;
  time?: Date | string;
  duration?: number;
  model?: string;
  tracks?: TrackInfo[];
  noTracks?: boolean; // by default there will normally be one track, set to true if you don't want tracks
  minsLater?: number; // minutes that later that the recording is taken
  secsLater?: number; // minutes that later that the recording is taken
  tags?: string[]; // short cut for defining tags for each track
  lat?: number; // Latitude position for the recording
  lng?: number; // Longitude position for the recording
}

declare namespace Cypress {
  interface Chainable {
    /**
     * upload a single recording to for a particular camera
     */
    uploadRecording(
      cameraName: string,
      details: ThermalRecordingInfo,
      log?: boolean
    ): Cypress.Chainable<Interception>;

    uploadRecordingThenUserTag(
      cameraName: string,
      details: ThermalRecordingInfo,
      tagger: string,
      tag: string
    );

    userTagRecording(
      recordingId: number,
      trackIndex: number,
      tagger: string,
      tag: string
    );

    uploadRecordingsAtTimes(cameraName: string, times: string[]);

    // to be run straight after an uploadRecording
    thenUserTagAs(tagger: string, tag: string);
  }
}
