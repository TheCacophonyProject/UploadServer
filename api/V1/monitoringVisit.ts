import moment, { Moment } from "moment";
import { MonitoringPageCriteria, MonitoringParams } from "./monitoringPage";
import models from "../../models";
import { Recording } from "../../models/Recording";
import { getTrackTag, unidentifiedTags } from "./Visits";
import { User } from "../../models/User";
import { ClientError } from "../customErrors";

const MINUTE = 60;
const MAX_SECS_BETWEEN_RECORDINGS = 10 * MINUTE;
const MAX_SECS_VIDEO_LENGTH = 10 * MINUTE;
const RECORDINGS_LIMIT = 2000;
const MAX_MINS_AFTER_TIME = 70;

type TagName = string;
type Count = number;

class Visit {
  rawRecordings?: Recording[];
  classification?: string;
  classificationAi?: string;
  classFromUserTag?: boolean;
  deviceId: number;
  device: string;
  incomplete?: boolean;
  timeStart?: Moment;
  timeEnd?: Moment;
  recordings: VisitRecording[];
  stationId: number;
  station: string;
  tracks: number;

  constructor(device, stationId: number, station, recording: Recording) {
    this.device = device.devicename;
    this.deviceId = device.id;
    this.recordings = [];
    this.rawRecordings = [];
    this.tracks = 0;
    this.station = station ? station.name : "";
    this.stationId = stationId || 0;

    this.rawRecordings.push(recording);
    this.timeStart = moment(recording.recordingDateTime);
    this.timeEnd = moment(this.timeStart).add(recording.duration, "seconds");
  }

  stationsMatch(stationId: number) {
    return this.stationId == stationId;
  }

  // note this function assumes that the recording start later than recordings already included
  isRecordingInVisit(recording: Recording) {
    if (!this.timeEnd) {
      return true;
    }

    const cutoff = moment(this.timeEnd).add(
      MAX_SECS_BETWEEN_RECORDINGS,
      "seconds"
    );
    return cutoff.isAfter(recording.recordingDateTime);
  }

  addRecordingIfWithinTimeLimits(recording: Recording): boolean {
    if (!this.isRecordingInVisit(recording)) {
      return false;
    }

    this.rawRecordings.push(recording);
    this.timeEnd = moment(recording.recordingDateTime).add(
      recording.duration,
      "seconds"
    );

    return true;
  }

  calculateTags(aiModel: string) {
    this.rawRecordings.forEach((rec) => {
      this.recordings.push(this.calculateTrackTags(rec, aiModel));
    });
    delete this.rawRecordings;

    const allVisitTracks = this.getAllTracks();
    this.tracks = allVisitTracks.length;
    const bestHumanTags = getBestGuessOverall(allVisitTracks, HUMAN_ONLY);

    if (bestHumanTags.length > 0) {
      this.classification = bestHumanTags[0];
      this.classFromUserTag = true;
    } else {
      const bestAiTags = getBestGuessOverall(allVisitTracks, AI_ONLY);
      this.classification = bestAiTags.length > 0 ? bestAiTags[0] : "none";
      this.classFromUserTag = false;
    }

    const aiGuess = getBestGuessFromSpecifiedAi(allVisitTracks);
    this.classificationAi = aiGuess.length > 0 ? aiGuess[0] : "none";
  }

  calculateTrackTags(recording, aiModel: string): VisitRecording {
    const newVisitRecording: VisitRecording = {
      recId: recording.id,
      start: recording.recordingDateTime,
      tracks: []
    };
    for (const track of (recording as any).Tracks) {
      const bestTag = getTrackTag(track.TrackTags);
      let aiTag = [];
      if (track.TrackTags) {
        aiTag = track.TrackTags.filter((tag) => tag.data == aiModel);
      }

      newVisitRecording.tracks.push({
        tag: bestTag ? bestTag.what : null,
        isAITagged: bestTag ? bestTag.automatic : false,
        aiTag: aiTag.length > 0 ? aiTag[0].what : null,
        start: track.data ? track.data.start_s : "",
        end: track.data ? track.data.end_s : ""
      });
    }
    return newVisitRecording;
  }

  getAllTracks(): VisitTrack[] {
    const allVisitTracks: VisitTrack[] = [];
    this.recordings.forEach((recording) => {
      allVisitTracks.push(...recording.tracks);
    });
    return allVisitTracks;
  }

  markIfPossiblyIncomplete(cutoff: Moment) {
    this.incomplete =
      this.incomplete || !this.timeEnd || this.timeEnd.isAfter(cutoff);
  }
}

const TAG = 0;
const COUNT = 1;

const HUMAN_ONLY = false;
const AI_ONLY = true;

function getBestGuessFromSpecifiedAi(tracks: VisitTrack[]): string[] {
  const counts = {};
  tracks.forEach((track) => {
    const tag = track.aiTag;
    if (tag) {
      counts[tag] = counts[tag] ? (counts[tag] += 1) : 1;
    }
  });
  return getBestGuess(Object.entries(counts));
}

function getBestGuessOverall(allTracks: VisitTrack[], isAi: boolean): string[] {
  const tracks = allTracks.filter((track) => track.isAITagged == isAi);

  const counts = {};
  tracks.forEach((track) => {
    const tag = track.tag;
    if (tag) {
      counts[tag] = counts[tag] ? (counts[tag] += 1) : 1;
    }
  });

  return getBestGuess(Object.entries(counts));
}

function getBestGuess(counts: [TagName, Count][]): TagName[] {
  const animalOnlyCounts = counts.filter(
    (tc) => !unidentifiedTags.includes(tc[TAG])
  );
  if (animalOnlyCounts.length > 0) {
    // there are animal tags
    const maxCount = animalOnlyCounts.reduce(
      (max, item) => Math.max(max, item[COUNT]),
      0
    );
    const tagsWithMaxCount = animalOnlyCounts
      .filter((tc) => tc[COUNT] === maxCount)
      .map((tc) => tc[TAG]);
    return tagsWithMaxCount;
  } else {
    return counts.map((tc) => tc[TAG]);
  }
}

interface VisitRecording {
  recId: number;
  start: string;
  tracks: VisitTrack[];
}

interface VisitTrack {
  // this is the overriding tag that we have given this event
  // e.g. if it was unidentified but grouped under a cat visit
  // assumedTag woudl be "cat"
  tag: string;
  aiTag: string;
  isAITagged: boolean;
  start: string;
  end: string;
}

export async function generateVisits(
  user: User,
  search: MonitoringPageCriteria,
  viewAsSuperAdmin: boolean
) {
  const search_start = moment(search.pageFrom).subtract(
    MAX_SECS_BETWEEN_RECORDINGS + MAX_SECS_VIDEO_LENGTH,
    "seconds"
  );
  const search_end = moment(search.pageUntil).add(
    MAX_MINS_AFTER_TIME,
    "minutes"
  );

  const recordings = await getRecordings(
    user,
    search,
    search_start,
    search_end,
    viewAsSuperAdmin
  );
  if (recordings.length == RECORDINGS_LIMIT) {
    throw new ClientError(
      "Too many recordings to retrieve.   Please reduce your page size"
    );
  }

  const visits = groupRecordingsIntoVisits(
    recordings,
    moment(search.pageFrom),
    moment(search.pageUntil),
    search.page == search.pagesEstimate
  );

  const incompleteCutoff = moment(search_end).subtract(
    MAX_SECS_BETWEEN_RECORDINGS,
    "seconds"
  );

  visits.forEach((visit) => {
    visit.calculateTags(search.compareAi);
    visit.markIfPossiblyIncomplete(incompleteCutoff);
  });

  return visits.reverse();
}

async function getRecordings(
  user: User,
  params: MonitoringPageCriteria,
  from: Moment,
  until: Moment,
  viewAsSuperAdmin: boolean
) {
  const where: any = {
    duration: { $gte: "0" },
    type: "thermalRaw",
    recordingDateTime: { $gte: from, $lt: until }
  };
  if (params.devices) {
    where.DeviceId = params.devices;
  }
  if (params.groups) {
    where.GroupId = params.groups;
  }
  const order = [["recordingDateTime", "ASC"]];

  const builder = await new models.Recording.queryBuilder().init(
    user,
    where,
    null,
    null,
    null,
    RECORDINGS_LIMIT,
    order,
    viewAsSuperAdmin
  );

  return models.Recording.findAll(builder.get());
}

function groupRecordingsIntoVisits(
  recordings: Recording[],
  start: Moment,
  end: Moment,
  isLastPage: boolean
): Visit[] {
  const currentVisitForDevice: { [key: number]: Visit } = {};
  const visitsStartingInPeriod: Visit[] = [];
  const earlierVisits: Visit[] = [];

  recordings.forEach((rec) => {
    const recording = rec as any;
    const stationId = recording.StationId || 0;
    const currentVisit: Visit = currentVisitForDevice[rec.DeviceId];
    const matchingVisit =
      currentVisit && currentVisit.stationsMatch(stationId)
        ? currentVisit
        : null;
    if (!matchingVisit || !matchingVisit.addRecordingIfWithinTimeLimits(rec)) {
      if (end.isSameOrAfter(rec.recordingDateTime)) {
        // start a new visit
        const newVisit = new Visit(
          recording.Device,
          stationId,
          recording.Station,
          rec
        );
        // we want to keep adding recordings to this visit even if first recording is before
        // before the search period
        currentVisitForDevice[rec.DeviceId] = newVisit;

        if (newVisit.timeStart.isAfter(start)) {
          visitsStartingInPeriod.push(newVisit);
        } else {
          // First recording for this visit is actually before the time period.
          // Therefore this visit isn't really part of this time period but some of the its recordings are

          // But if totally missing from the list user may wonder where recordings are so return visit anyway
          // (only relevant to the last page which shows the earliest recordings)
          newVisit.incomplete = true;
          earlierVisits.push(newVisit);
        }
      }
    }
  });

  if (isLastPage) {
    const overlappingVisits = earlierVisits.filter((visit) =>
      visit.timeEnd.isAfter(start)
    );
    return [...overlappingVisits, ...visitsStartingInPeriod];
  }
  return visitsStartingInPeriod;
}
