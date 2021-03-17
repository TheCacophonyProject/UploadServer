// load the global Cypress types
/// <reference types="cypress" />
import { getTestName } from "../names";
import { v1ApiPath, getCreds, makeAuthorizedRequest } from "../server";
import { logTestDescription } from "../descriptions";

export const EventTypes = {
  POWERED_ON: "rpi-power-on",
  POWERED_OFF: "daytime-power-off",
  STOP_REPORTED: "stop-reported"
};

Cypress.Commands.add(
  "checkPowerEvents",
  (user: string, camera: string, expectedEvent: ComparablePowerEvent) => {
    logTestDescription(
      `Check power events for ${camera} is ${JSON.stringify(expectedEvent)}}`,
      {
        user,
        camera,
        expectedEvent
      }
    );

    checkEvents(user, camera, expectedEvent);
  }
);

function checkEvents(
  user: string,
  camera: string,
  expectedEvent: ComparablePowerEvent
) {
  const params = {
    deviceID: getCreds(camera).id
  };

  cy.request({
    method: "GET",
    url: v1ApiPath("events/powerEvents", params),
    headers: getCreds(user).headers
  }).then((response) => {
    checkResponseMatches(response, expectedEvent);
  });
}

function checkResponseMatches(
  response: Cypress.Response,
  expectedEvent: ComparablePowerEvent
) {
  expect(response.body.events.length, `Expected 1 event`).to.eq(1);
  const powerEvent = response.body.events[0];

  expect(
    powerEvent.hasStopped,
    `Device should be ${expectedEvent.hasStopped ? "stopped" : "running"}`
  ).to.eq(expectedEvent.hasStopped);
  expect(
    powerEvent.hasAlerted,
    `Device should have been ${
      expectedEvent.hasAlerted ? "alerted" : "not alerted"
    }`
  ).to.eq(expectedEvent.hasAlerted);
}
