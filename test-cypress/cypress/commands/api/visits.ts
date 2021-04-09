// load the global Cypress types
/// <reference types="cypress" />

import { v1ApiPath, getCreds } from "../server";
import { logTestDescription } from "../descriptions";

Cypress.Commands.add(
  "checkVisitTags",
  (user: string, camera: string, expectedTags: string[]) => {
    const expectedVisits = expectedTags.map((tag) => {
      return { tag };
    });

    logTestDescription(
      `Check visit tags match ${JSON.stringify(expectedTags)}`,
      {
        user,
        camera,
        expectedVisits
      }
    );

    checkVisitsMatch(user, camera, expectedVisits);
  }
);

Cypress.Commands.add(
  "checkVisits",
  (user: string, camera: string, expectedVisits: ComparableVisit[]) => {
    logTestDescription(`Check visits match ${JSON.stringify(expectedVisits)}`, {
      user,
      camera,
      expectedVisits
    });

    checkVisitsMatch(user, camera, expectedVisits);
  }
);

function checkVisitsMatch(
  user: string,
  camera: string,
  expectedVisits: ComparableVisit[]
) {
  
  const params : any = {
    page: 1,
    "page-size": 100,
  };
  
  if (camera) {
    params.devices = getCreds(camera).id;
  }

  cy.request({
    method: "GET",
    url: v1ApiPath("monitoring/page", params),
    headers: getCreds(user).headers
  }).then((response) => {
    checkResponseMatches(response, expectedVisits);
  });
}

function checkResponseMatches(
  response: Cypress.Response,
  expectedVisits: ComparableVisit[]
) {
  const responseVisits = response.body.result.results;

  expect(
    responseVisits.length,
    `Number of visits to be ${responseVisits.length}`
  ).to.eq(expectedVisits.length);
  const increasingDateResponseVisits = responseVisits.reverse();

  // pull out the bits we care about
  const responseVisitsToCompare: ComparableVisit[] = [];
  for (var i = 0; i < expectedVisits.length; i++) {
    const expectedVisit = expectedVisits[i];
    const completeResponseVisit = increasingDateResponseVisits[i];
    const simplifiedResponseVisit: ComparableVisit = {};

    if (expectedVisit.tag) {
      simplifiedResponseVisit.tag = completeResponseVisit.what || "<null>";
    }

    if (expectedVisit.recordings) {
      simplifiedResponseVisit.recordings =  completeResponseVisit.recordings.length;
    }

    if (expectedVisit.start) {
      simplifiedResponseVisit.start = completeResponseVisit.start;
    }

    if (expectedVisit.end) {
      simplifiedResponseVisit.end = completeResponseVisit.end;
    }

    responseVisitsToCompare.push(simplifiedResponseVisit);
  }
  expect(JSON.stringify(responseVisitsToCompare)).to.eq(
    JSON.stringify(expectedVisits)
  );
}

interface VisitsWhere {
  type: string;
  duration?: any;
  DeviceId?: number;
}
